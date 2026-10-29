#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  analyzePrivilegedChange,
  privilegedChangeCheckState,
} from "./lib/privileged-change-analyze.mjs";
import { decidePrivilegedChangeCommentAction } from "./lib/privileged-change-comment-lifecycle.mjs";
import {
  addIssueLabels,
  ensurePrivilegedChangeLabels,
  privilegedChangeLabel,
  privilegedChangeReviewedLabel,
  removeIssueLabel,
} from "./lib/privileged-change-labels.mjs";
import { ghApiCall } from "./lib/privileged-gh-api.mjs";
import {
  parsePullRequestFilesApiStdout,
  shouldFetchWorkflowFileContent,
} from "./lib/privileged-pull-files-api.mjs";
import { shouldClearStalePrivilegedReview } from "./lib/privileged-change-stale-review.mjs";
import {
  assessPackageJsonScriptsChange,
  mergePackageJsonScriptsAssessment,
  readPackageJsonViaContentsApi,
} from "./lib/privileged-package-scripts.mjs";
import { isWorkflowFile } from "./lib/privileged-paths.mjs";
import { privilegedChangeErrorStatusPayload } from "./lib/privileged-change-status.mjs";
import { buildPrivilegedChangeCommentBody } from "./privileged-change-comment-body.mjs";

export const PRIVILEGED_CHANGE_MARKER = "<!-- project-factory-privileged-change -->";

/**
 * @param {import('./lib/privileged-gh-api.mjs').GhExec} exec
 * @param {Record<string, string | undefined>} env
 * @param {string[]} args
 * @param {string} [input]
 */
function ghApi(exec, env, args, input) {
  return ghApiCall(exec, env, args, input);
}

/**
 * @param {string} repo
 * @param {string} headSha
 * @param {import('./lib/privileged-gh-api.mjs').GhExec} exec
 * @param {Record<string, string | undefined>} env
 */
export function postPrivilegedChangeErrorStatus(repo, headSha, exec, env) {
  ghApi(
    exec,
    env,
    ["--method", "POST", `repos/${repo}/statuses/${headSha}`],
    JSON.stringify(privilegedChangeErrorStatusPayload()),
  );
}

/**
 * @param {string} repo
 * @param {string} prNumber
 * @param {import('./lib/privileged-gh-api.mjs').GhExec} exec
 * @param {Record<string, string | undefined>} env
 */
function findMarkerCommentId(repo, prNumber, exec, env) {
  const commentIds = exec(
    "gh",
    [
      "api",
      `repos/${repo}/issues/${prNumber}/comments`,
      "--paginate",
      "--jq",
      `.[] | select(.user.login == "github-actions[bot]" and (.body | contains("${PRIVILEGED_CHANGE_MARKER}"))) | .id`,
    ],
    { encoding: "utf8", env },
  ).trim();
  const commentId = commentIds.split("\n")[0]?.trim();
  return commentId || null;
}

/**
 * @param {{ exec?: import('./lib/privileged-gh-api.mjs').GhExec; env?: Record<string, string | undefined> }} [options]
 * @returns {number} exit code
 */
export function runPrivilegedChange(options = {}) {
  const exec = options.exec ?? execFileSync;
  const env = {
    ...process.env,
    ...options.env,
  };

  const repo = env.REPOSITORY ?? env.GITHUB_REPOSITORY;
  const prNumber = env.PR_NUMBER;
  const headSha = env.HEAD_SHA;
  const trustedOrg = env.TRUSTED_ORG;
  const eventAction = env.EVENT_ACTION ?? "";

  if (!repo || !prNumber || !headSha || !trustedOrg) {
    console.error(
      "Set REPOSITORY (or GITHUB_REPOSITORY), PR_NUMBER, HEAD_SHA, and TRUSTED_ORG",
    );
    return 1;
  }

  try {
    ensurePrivilegedChangeLabels(repo, exec, env);

    const filesStdout = ghApi(exec, env, [
      `repos/${repo}/pulls/${prNumber}/files?per_page=100`,
      "--paginate",
      "--slurp",
    ]);
    const changedFiles = parsePullRequestFilesApiStdout(filesStdout);

    const prJson = ghApi(exec, env, [`repos/${repo}/pulls/${prNumber}`]);
    const pr = JSON.parse(prJson);
    let prLabels = (pr.labels ?? []).map((l) => l.name);

    /** @type {Record<string, string>} */
    const workflowContentsByPath = {};
    for (const file of changedFiles) {
      if (!isWorkflowFile(file.filename)) {
        continue;
      }
      if (!shouldFetchWorkflowFileContent(file.status)) {
        continue;
      }
      const encoded = file.filename
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      const contentJson = ghApi(exec, env, [
        `repos/${repo}/contents/${encoded}?ref=${headSha}`,
      ]);
      const payload = JSON.parse(contentJson);
      if (payload.content && payload.encoding === "base64") {
        workflowContentsByPath[file.filename] = Buffer.from(
          payload.content,
          "base64",
        ).toString("utf8");
      }
    }

    const analysisBase = analyzePrivilegedChange(changedFiles, workflowContentsByPath, {
      trustedOrg,
    });

    const baseSha = pr.base?.sha;
    if (!baseSha) {
      throw new Error("pull request missing base.sha");
    }

    const packageJsonAssessment = assessPackageJsonScriptsChange(
      changedFiles,
      (ref) => readPackageJsonViaContentsApi(exec, env, repo, ref, ghApi),
      baseSha,
      headSha,
    );
    const analysis = mergePackageJsonScriptsAssessment(
      analysisBase,
      packageJsonAssessment,
    );

    const staleReviewCleared = shouldClearStalePrivilegedReview(
      eventAction,
      analysis.flagged,
      prLabels,
    );
    if (staleReviewCleared) {
      removeIssueLabel(repo, prNumber, privilegedChangeReviewedLabel, exec, env);
      prLabels = prLabels.filter((name) => name !== privilegedChangeReviewedLabel);
    }

    const existingCommentId = findMarkerCommentId(repo, prNumber, exec, env);
    const commentAction = decidePrivilegedChangeCommentAction(
      analysis.flagged,
      existingCommentId !== null,
    );

    if (commentAction !== "skip") {
      const body = buildPrivilegedChangeCommentBody(analysis, {
        staleReviewNotice: staleReviewCleared && analysis.flagged,
      });
      const commentPayload = JSON.stringify({ body });
      if (commentAction === "update" && existingCommentId) {
        ghApi(
          exec,
          env,
          ["--method", "PATCH", `repos/${repo}/issues/comments/${existingCommentId}`],
          commentPayload,
        );
      } else {
        ghApi(
          exec,
          env,
          ["--method", "POST", `repos/${repo}/issues/${prNumber}/comments`],
          commentPayload,
        );
      }
    }

    const hasFlagLabel = prLabels.includes(privilegedChangeLabel);
    if (analysis.flagged && !hasFlagLabel) {
      addIssueLabels(repo, prNumber, [privilegedChangeLabel], exec, env);
    } else if (!analysis.flagged && hasFlagLabel) {
      removeIssueLabel(repo, prNumber, privilegedChangeLabel, exec, env);
    }

    const checkState = privilegedChangeCheckState(analysis.flagged, prLabels);
    const description =
      checkState === "success"
        ? analysis.flagged
          ? "Privileged change reviewed"
          : "No privileged paths changed"
        : "Privileged change needs maintainer review (add privileged-change-reviewed)";

    ghApi(
      exec,
      env,
      ["--method", "POST", `repos/${repo}/statuses/${headSha}`],
      JSON.stringify({
        state: checkState,
        context: "privileged-change",
        description,
      }),
    );

    console.log(
      JSON.stringify({
        flagged: analysis.flagged,
        checkState,
        commentAction,
        staleReviewCleared,
        privilegedFileCount: analysis.privilegedFiles.length,
        findingCount: analysis.findings.length,
      }),
    );
    return 0;
  } catch (err) {
    try {
      postPrivilegedChangeErrorStatus(repo, headSha, exec, env);
    } catch (statusErr) {
      console.error("Failed to post privileged-change error status:", statusErr);
    }
    console.error(err);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exit(runPrivilegedChange());
}
