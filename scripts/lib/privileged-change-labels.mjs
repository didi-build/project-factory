import { execFileSync } from "node:child_process";
import { shouldIgnoreIssueLabelDeleteError } from "./gh-api-errors.mjs";
import { buildGhApiArgs } from "./privileged-gh-api.mjs";

export const privilegedChangeLabel = "privileged-change";
export const privilegedChangeReviewedLabel = "privileged-change-reviewed";

/** @type {{ name: string; color: string; description: string }[]} */
const LABELS = [
  {
    name: privilegedChangeLabel,
    color: "B60205",
    description: "PR touches privileged deploy or workflow paths (review required)",
  },
  {
    name: privilegedChangeReviewedLabel,
    color: "0E8A16",
    description: "Maintainer reviewed privileged-change warning",
  },
];

/**
 * @param {Record<string, string | undefined>} env
 */
function tokenEnv(env) {
  return {
    ...env,
    GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN,
  };
}

/**
 * @param {string} repo
 * @param {import('./privileged-gh-api.mjs').GhExec} [exec]
 * @param {Record<string, string | undefined>} [env]
 */
export function ensurePrivilegedChangeLabels(
  repo,
  exec = execFileSync,
  env = process.env,
) {
  const ghEnv = tokenEnv(env);
  const names = JSON.parse(
    exec("gh", ["label", "list", "--repo", repo, "--limit", "200", "--json", "name"], {
      encoding: "utf8",
      env: ghEnv,
    }),
  ).map((l) => l.name);

  for (const label of LABELS) {
    if (names.includes(label.name)) {
      continue;
    }
    exec(
      "gh",
      [
        "label",
        "create",
        label.name,
        "--repo",
        repo,
        "--color",
        label.color,
        "--description",
        label.description,
      ],
      { stdio: "inherit", env: ghEnv },
    );
  }
}

/**
 * @param {string} repo
 * @param {string | number} issueNumber
 * @param {string[]} labels
 * @param {import('./privileged-gh-api.mjs').GhExec} [exec]
 * @param {Record<string, string | undefined>} [env]
 */
export function addIssueLabels(
  repo,
  issueNumber,
  labels,
  exec = execFileSync,
  env = process.env,
) {
  if (labels.length === 0) {
    return;
  }
  const body = JSON.stringify({ labels });
  exec(
    "gh",
    buildGhApiArgs(
      ["--method", "POST", `repos/${repo}/issues/${issueNumber}/labels`],
      true,
    ),
    {
      encoding: "utf8",
      input: body,
      env: tokenEnv(env),
    },
  );
}

/**
 * @param {string} repo
 * @param {string | number} issueNumber
 * @param {string} label
 * @param {import('./privileged-gh-api.mjs').GhExec} [exec]
 * @param {Record<string, string | undefined>} [env]
 */
export function removeIssueLabel(
  repo,
  issueNumber,
  label,
  exec = execFileSync,
  env = process.env,
) {
  try {
    exec(
      "gh",
      [
        "api",
        "--method",
        "DELETE",
        `repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
      ],
      { encoding: "utf8", env: tokenEnv(env), stdio: "pipe" },
    );
  } catch (err) {
    const stderr =
      err &&
      typeof err === "object" &&
      "stderr" in err &&
      typeof err.stderr === "string"
        ? err.stderr
        : String(err);
    if (shouldIgnoreIssueLabelDeleteError(stderr)) {
      return;
    }
    throw err;
  }
}
