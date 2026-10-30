import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import {
  protectionLooksCorrect,
  targetBranchProtectionPayload,
} from "../factory/branch-protection.js";
import {
  BOOTSTRAP_MAX_API_CALLS,
  BOOTSTRAP_POLL_MS,
  BOOTSTRAP_WAIT_MS,
  DEFAULT_BRANCH,
  FACTORY_TOPIC,
} from "../factory/constants.js";
import {
  decodeGithubFileContent,
  readmeHasLaunchpadPlaceholders,
} from "../factory/github-content.js";
import { STANDARD_FACTORY_LABELS, standardLabelNames } from "../factory/labels.js";
import { validateProjectName } from "../factory/naming.js";
import { GitHubClient } from "../github/client.js";
import { mapGithubFailure } from "../github/github-errors.js";
import {
  buildCreateProjectRepoDryRunPlan,
  summarizeCreateProjectRepoDryRunPlan,
  type CreateProjectRepoDryRunSummary,
  type DryRunPlan,
} from "./dry-run-plan.js";
import type { FactoryError, FactoryStep, FactorySuccess } from "./types.js";

export type CreateProjectRepoInput = {
  name: string;
  description: string;
  private?: boolean;
  approval_ref: string;
  dry_run?: boolean;
};

export type CreateProjectRepoContext = {
  env: ProjectFactoryEnv;
  requestId: string;
  caller: string;
  github?: GitHubClient;
  fetchImpl?: typeof fetch;
};

function parseTemplateRepo(template: string): { owner: string; repo: string } {
  const [owner, repo] = template.split("/");
  if (!owner || !repo) {
    throw new Error("invalid PROJECT_FACTORY_TEMPLATE_REPO");
  }
  return { owner, repo };
}

function factoryError(
  code: string,
  message: string,
  step?: string,
  retryable = false,
): FactoryError {
  return { error: { code, message, step, retryable } };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFactoryTopics(
  github: GitHubClient,
  repoFull: string,
): Promise<
  | { ok: true; names: string[]; factoryOwned: boolean }
  | { ok: false; error: FactoryError }
> {
  const topicsResult = await github.request("GET", `/repos/${repoFull}/topics`);
  if (!topicsResult.ok) {
    if (topicsResult.error.status === 404) {
      return { ok: true, names: [], factoryOwned: false };
    }
    return { ok: false, error: mapGithubFailure(topicsResult.error, "read_topics") };
  }
  const names =
    topicsResult.data && typeof topicsResult.data === "object"
      ? ((topicsResult.data as { names?: string[] }).names ?? [])
      : [];
  return { ok: true, names, factoryOwned: names.includes(FACTORY_TOPIC) };
}

function missingGithubConfigError(env: ProjectFactoryEnv): FactoryError | null {
  if (!env.PROJECT_FACTORY_GH_APP_ID) {
    return factoryError("missing_secret", "PROJECT_FACTORY_GH_APP_ID");
  }
  if (!env.PROJECT_FACTORY_GH_INSTALLATION_ID) {
    return factoryError("missing_secret", "PROJECT_FACTORY_GH_INSTALLATION_ID");
  }
  return null;
}

function pendingBootstrapSuccess(
  ctx: CreateProjectRepoContext,
  steps: FactoryStep[],
  warnings: string[],
  repoUrl: string,
  protectionOk: boolean,
): FactorySuccess {
  warnings.push("Bootstrap may still be running; call again later");
  return {
    request_id: ctx.requestId,
    status: "pending_bootstrap",
    steps,
    warnings,
    repo_url: repoUrl,
    default_branch: DEFAULT_BRANCH,
    labels: standardLabelNames(),
    protection_ok: protectionOk,
    dry_run: false,
  } as FactorySuccess & {
    repo_url: string;
    default_branch: string;
    labels: string[];
    protection_ok: boolean;
    dry_run: boolean;
  };
}

export async function createProjectRepo(
  ctx: CreateProjectRepoContext,
  input: CreateProjectRepoInput,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const dryRun = input.dry_run !== false;
  const description = input.description.trim();
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];
  let auditStatus = "started";
  let failedStep: string | undefined;
  let auditExtras: {
    steps?: FactoryStep[];
    github_installation_token_minted?: boolean;
    github_installation_token_permissions?: Record<string, string>;
  } = {};
  const org = ctx.env.PROJECT_FACTORY_GH_ORG;
  const repoFull = `${org}/${input.name}`;
  const repoUrl = `https://github.com/${repoFull}`;
  const isPrivate = input.private === true;

  const finishAudit = () => {
    writeAuditEntry({
      request_id: ctx.requestId,
      caller: ctx.caller,
      tool: "create_project_repo",
      dry_run: dryRun,
      input: {
        name: input.name,
        description,
        private: isPrivate,
        approval_ref: input.approval_ref,
      },
      approval_ref: input.approval_ref,
      status: auditStatus,
      resources: { repo_url: repoUrl },
      duration_ms: Date.now() - started,
      steps: auditExtras.steps ?? (steps.length > 0 ? [...steps] : undefined),
      failed_step: failedStep,
      github_installation_token_minted: auditExtras.github_installation_token_minted,
      github_installation_token_permissions:
        auditExtras.github_installation_token_permissions,
    });
  };

  try {
    const nameCheck = validateProjectName(input.name);
    if (!nameCheck.ok) {
      auditStatus = nameCheck.code;
      return factoryError(nameCheck.code, nameCheck.message);
    }
    if (!description || description.length < 1 || description.length > 350) {
      auditStatus = "invalid_input";
      return factoryError(
        "invalid_input",
        "description is required and must be 1 to 350 characters",
      );
    }
    if (!input.approval_ref?.trim()) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", "approval_ref is required");
    }

    const configError = missingGithubConfigError(ctx.env);
    if (configError) {
      auditStatus = "missing_secret";
      return configError;
    }

    if (dryRun) {
      const built = await buildCreateProjectRepoDryRunPlan(
        ctx.env,
        {
          name: input.name,
          org,
          templateRepo: ctx.env.PROJECT_FACTORY_TEMPLATE_REPO,
          isPrivate,
        },
        { fetchImpl: ctx.fetchImpl },
      );
      if (!built.ok) {
        auditStatus = built.error.code;
        return { error: built.error };
      }
      const plan = built.plan;
      auditStatus = plan.status;
      auditExtras = {
        steps: plan.steps,
        github_installation_token_minted: plan.github.github_installation_token_minted,
        github_installation_token_permissions: plan.github
          .github_installation_token_minted
          ? { ...plan.github.github_installation_token_permissions }
          : undefined,
      };
      return {
        request_id: ctx.requestId,
        ...plan,
        summary: summarizeCreateProjectRepoDryRunPlan(plan),
      } as FactorySuccess & DryRunPlan & { summary: CreateProjectRepoDryRunSummary };
    }

    if (!ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
      auditStatus = "missing_secret";
      return factoryError("missing_secret", "PROJECT_FACTORY_GH_PRIVATE_KEY");
    }

    const github =
      ctx.github ??
      new GitHubClient({
        appId: ctx.env.PROJECT_FACTORY_GH_APP_ID,
        installationId: ctx.env.PROJECT_FACTORY_GH_INSTALLATION_ID,
        privateKeyPem: ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY,
        fetchImpl: ctx.fetchImpl,
      });

    let repoExists = false;
    let factoryOwned = false;
    let createdThisRun = false;

    const existing = await github.request("GET", `/repos/${repoFull}`);
    if (existing.ok) {
      repoExists = true;
      const topics = await readFactoryTopics(github, repoFull);
      if (!topics.ok) {
        auditStatus = topics.error.error.code;
        failedStep = topics.error.error.step;
        return topics.error;
      }
      factoryOwned = topics.factoryOwned;
      if (!factoryOwned) {
        auditStatus = "conflict_not_factory_owned";
        failedStep = "read_topics";
        return factoryError(
          "conflict_not_factory_owned",
          `repository ${repoFull} exists without the project-factory topic`,
          "read_topics",
        );
      }
      steps.push({ id: "repo_exists", status: "skipped", detail: repoUrl });
    } else if (existing.error.status === 404) {
      repoExists = false;
    } else {
      const mapped = mapGithubFailure(existing.error, "read_repo");
      auditStatus = mapped.error.code;
      failedStep = mapped.error.step;
      return mapped;
    }

    const template = parseTemplateRepo(ctx.env.PROJECT_FACTORY_TEMPLATE_REPO);

    if (!repoExists) {
      const create = await github.request(
        "POST",
        `/repos/${template.owner}/${template.repo}/generate`,
        {
          owner: org,
          name: input.name,
          description,
          private: isPrivate,
          include_all_branches: false,
        },
      );
      if (!create.ok) {
        if (create.error.status === 422) {
          const topics = await readFactoryTopics(github, repoFull);
          if (!topics.ok) {
            auditStatus = topics.error.error.code;
            failedStep = topics.error.error.step;
            return topics.error;
          }
          if (!topics.factoryOwned) {
            auditStatus = "conflict_not_factory_owned";
            failedStep = "create_repo";
            return factoryError(
              "conflict_not_factory_owned",
              `repository ${repoFull} exists without the project-factory topic`,
              "create_repo",
            );
          }
          repoExists = true;
          factoryOwned = true;
          steps.push({
            id: "create_repo",
            status: "skipped",
            detail: "already exists",
          });
        } else if (create.error.status === 403) {
          auditStatus = "permission_denied";
          failedStep = "create_repo";
          return mapGithubFailure(create.error, "create_repo");
        } else {
          const mapped = mapGithubFailure(create.error, "create_repo");
          auditStatus = mapped.error.code;
          failedStep = mapped.error.step;
          return mapped;
        }
      } else {
        createdThisRun = true;
        repoExists = true;
        steps.push({ id: "create_repo", status: "done", detail: repoUrl });
        const topic = await github.request("PUT", `/repos/${repoFull}/topics`, {
          names: [FACTORY_TOPIC],
        });
        if (!topic.ok) {
          auditStatus = "upstream_error";
          failedStep = "set_topic";
          return factoryError(
            "upstream_error",
            "Generate created the repo but setting the project-factory topic failed; open a Ready for maintainer ticket",
            "set_topic",
            topic.error.retryable,
          );
        }
        factoryOwned = true;
        steps.push({ id: "set_topic", status: "done", detail: FACTORY_TOPIC });
      }
    }

    if (createdThisRun) {
      const branch = await github.request(
        "GET",
        `/repos/${repoFull}/branches/${DEFAULT_BRANCH}`,
      );
      if (!branch.ok && branch.error.status === 404) {
        auditStatus = "pending_bootstrap";
        return pendingBootstrapSuccess(ctx, steps, warnings, repoUrl, false);
      }
      if (!branch.ok) {
        const mapped = mapGithubFailure(branch.error, "read_branch");
        auditStatus = mapped.error.code;
        failedStep = mapped.error.step;
        return mapped;
      }
    }

    const protectionStepId = "branch_protection";
    const protection = await github.request(
      "GET",
      `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
    );
    if (!protection.ok && protection.error.status !== 404) {
      const mapped = mapGithubFailure(protection.error, protectionStepId);
      auditStatus = mapped.error.code;
      failedStep = mapped.error.step;
      return mapped;
    }
    const needsProtection =
      !protection.ok ||
      !protectionLooksCorrect(protection.data as Record<string, unknown>);
    if (needsProtection) {
      const apply = await github.request(
        "PUT",
        `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
        targetBranchProtectionPayload(),
      );
      if (!apply.ok) {
        if (createdThisRun && apply.error.status === 404) {
          auditStatus = "pending_bootstrap";
          return pendingBootstrapSuccess(ctx, steps, warnings, repoUrl, false);
        }
        const mapped = mapGithubFailure(apply.error, protectionStepId);
        auditStatus = mapped.error.code;
        failedStep = mapped.error.step;
        return mapped;
      }
      steps.push({ id: protectionStepId, status: "done" });
    } else {
      steps.push({ id: protectionStepId, status: "skipped" });
    }

    for (const label of STANDARD_FACTORY_LABELS) {
      const stepId = `label_${label.name}`;
      const created = await github.request("POST", `/repos/${repoFull}/labels`, label);
      if (created.ok || created.error.status === 422) {
        steps.push({
          id: stepId,
          status: created.ok ? "done" : "skipped",
          detail: label.name,
        });
      } else if (createdThisRun && created.error.status === 404) {
        auditStatus = "pending_bootstrap";
        return pendingBootstrapSuccess(ctx, steps, warnings, repoUrl, false);
      } else {
        const mapped = mapGithubFailure(created.error, stepId);
        auditStatus = mapped.error.code;
        failedStep = mapped.error.step;
        return mapped;
      }
    }

    let protectionOk = false;
    let bootstrapPending = false;
    const deadline = Date.now() + BOOTSTRAP_WAIT_MS;
    let apiCalls = 0;
    while (Date.now() < deadline && apiCalls + 3 <= BOOTSTRAP_MAX_API_CALLS) {
      apiCalls += 3;
      const readme = await github.request(
        "GET",
        `/repos/${repoFull}/contents/README.md`,
      );
      const wrangler = await github.request(
        "GET",
        `/repos/${repoFull}/contents/wrangler.jsonc`,
      );
      const prot = await github.request(
        "GET",
        `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
      );
      const readmeOk = readme.ok && !readmeHasLaunchpadPlaceholders(readme.data);
      let wranglerOk = false;
      if (wrangler.ok) {
        const decoded = decodeGithubFileContent(wrangler.data);
        wranglerOk =
          decoded !== null &&
          (decoded.includes(`"name": "${input.name}"`) ||
            decoded.includes(`"name":"${input.name}"`));
      }
      protectionOk =
        prot.ok && protectionLooksCorrect(prot.data as Record<string, unknown>);
      if (readmeOk && wranglerOk && protectionOk) {
        bootstrapPending = false;
        break;
      }
      bootstrapPending = true;
      await sleep(BOOTSTRAP_POLL_MS);
    }

    let status: string;
    if (bootstrapPending) {
      status = "pending_bootstrap";
      warnings.push("Bootstrap may still be running; call again later");
    } else if (steps.some((s) => s.status === "done" && s.id !== "repo_exists")) {
      status = factoryOwned && !createdThisRun ? "repaired" : "created";
    } else if (factoryOwned || repoExists) {
      status = "exists";
    } else {
      status = "created";
    }

    auditStatus = status;
    const result: FactorySuccess = {
      request_id: ctx.requestId,
      status,
      steps,
      warnings,
      repo_url: repoUrl,
      default_branch: DEFAULT_BRANCH,
      labels: standardLabelNames(),
      protection_ok: protectionOk,
      dry_run: false,
    } as FactorySuccess & {
      repo_url: string;
      default_branch: string;
      labels: string[];
      protection_ok: boolean;
      dry_run: boolean;
    };

    return result;
  } finally {
    finishAudit();
  }
}
