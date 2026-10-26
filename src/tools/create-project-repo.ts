import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import {
  protectionLooksCorrect,
  targetBranchProtectionPayload,
} from "../factory/branch-protection.js";
import {
  BOOTSTRAP_POLL_MS,
  BOOTSTRAP_WAIT_MS,
  DEFAULT_BRANCH,
  FACTORY_TOPIC,
} from "../factory/constants.js";
import { STANDARD_FACTORY_LABELS, standardLabelNames } from "../factory/labels.js";
import { validateProjectName } from "../factory/naming.js";
import { GitHubClient } from "../github/client.js";
import { buildCreateProjectRepoDryRunPlan } from "./dry-run-plan.js";
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

export async function createProjectRepo(
  ctx: CreateProjectRepoContext,
  input: CreateProjectRepoInput,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const dryRun = input.dry_run !== false;
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];

  const nameCheck = validateProjectName(input.name);
  if (!nameCheck.ok) {
    return factoryError(nameCheck.code, nameCheck.message);
  }
  if (
    !input.description ||
    input.description.length < 1 ||
    input.description.length > 350
  ) {
    return factoryError(
      "invalid_name",
      "description is required and must be 1 to 350 characters",
    );
  }
  if (!input.approval_ref?.trim()) {
    return factoryError("invalid_name", "approval_ref is required");
  }

  const org = ctx.env.PROJECT_FACTORY_GH_ORG;
  const repoFull = `${org}/${input.name}`;
  const repoUrl = `https://github.com/${repoFull}`;
  const isPrivate = input.private === true;

  if (!ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY && !dryRun) {
    return factoryError("missing_secret", "PROJECT_FACTORY_GH_PRIVATE_KEY");
  }
  if (
    !ctx.env.PROJECT_FACTORY_GH_APP_ID ||
    !ctx.env.PROJECT_FACTORY_GH_INSTALLATION_ID
  ) {
    return factoryError("missing_secret", "PROJECT_FACTORY_GH_APP_ID");
  }

  if (dryRun) {
    const plan = await buildCreateProjectRepoDryRunPlan(
      ctx.env,
      {
        name: input.name,
        org,
        templateRepo: ctx.env.PROJECT_FACTORY_TEMPLATE_REPO,
        isPrivate,
      },
      { fetchImpl: ctx.fetchImpl },
    );
    const plannedResult = {
      request_id: ctx.requestId,
      ...plan,
    };
    writeAuditEntry({
      request_id: ctx.requestId,
      caller: ctx.caller,
      tool: "create_project_repo",
      dry_run: true,
      input: {
        name: input.name,
        description: input.description,
        private: isPrivate,
        approval_ref: input.approval_ref,
      },
      approval_ref: input.approval_ref,
      status: plan.status,
      resources: { repo_url: repoUrl },
      duration_ms: Date.now() - started,
      github_installation_token_minted: plan.github.github_installation_token_minted,
      github_installation_token_permissions: plan.github
        .github_installation_token_minted
        ? { ...plan.github.github_installation_token_permissions }
        : undefined,
    });
    return plannedResult;
  }

  const github =
    ctx.github ??
    new GitHubClient({
      appId: ctx.env.PROJECT_FACTORY_GH_APP_ID,
      installationId: ctx.env.PROJECT_FACTORY_GH_INSTALLATION_ID,
      privateKeyPem: ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY ?? "",
    });

  const existing = await github.request("GET", `/repos/${repoFull}`);
  let repoExists = existing.ok;
  let factoryOwned = false;
  if (repoExists) {
    const topicsResult = await github.request("GET", `/repos/${repoFull}/topics`);
    const names =
      topicsResult.ok && topicsResult.data && typeof topicsResult.data === "object"
        ? ((topicsResult.data as { names?: string[] }).names ?? [])
        : [];
    factoryOwned = names.includes(FACTORY_TOPIC);
    if (!factoryOwned) {
      return factoryError(
        "conflict_not_factory_owned",
        `repository ${repoFull} exists without the project-factory topic`,
      );
    }
    steps.push({ id: "repo_exists", status: "skipped", detail: repoUrl });
  }

  const template = parseTemplateRepo(ctx.env.PROJECT_FACTORY_TEMPLATE_REPO);

  if (!repoExists) {
    const create = await github.request(
      "POST",
      `/repos/${template.owner}/${template.repo}/generate`,
      {
        owner: org,
        name: input.name,
        description: input.description,
        private: isPrivate,
        include_all_branches: false,
      },
    );
    if (!create.ok) {
      if (create.error.status === 422) {
        repoExists = true;
        steps.push({ id: "create_repo", status: "skipped", detail: "already exists" });
      } else if (create.error.status === 403) {
        return factoryError("permission_denied", create.error.message, "create_repo");
      } else {
        return factoryError(
          create.error.status === 429 ? "rate_limited" : "upstream_error",
          create.error.message,
          "create_repo",
          create.error.retryable,
        );
      }
    } else {
      steps.push({ id: "create_repo", status: "done", detail: repoUrl });
      repoExists = true;
      const topic = await github.request("PUT", `/repos/${repoFull}/topics`, {
        names: [FACTORY_TOPIC],
      });
      if (!topic.ok && topic.error.status !== 422) {
        return factoryError(
          "upstream_error",
          topic.error.message,
          "set_topic",
          topic.error.retryable,
        );
      }
      steps.push({ id: "set_topic", status: "done", detail: FACTORY_TOPIC });
    }
  }

  if (repoExists) {
    const topicsResult = await github.request("GET", `/repos/${repoFull}/topics`);
    const names =
      topicsResult.ok && topicsResult.data && typeof topicsResult.data === "object"
        ? ((topicsResult.data as { names?: string[] }).names ?? [])
        : [];
    if (!names.includes(FACTORY_TOPIC)) {
      const topic = await github.request("PUT", `/repos/${repoFull}/topics`, {
        names: [...names, FACTORY_TOPIC],
      });
      if (!topic.ok) {
        return factoryError(
          "upstream_error",
          topic.error.message,
          "set_topic",
          topic.error.retryable,
        );
      }
      steps.push({ id: "set_topic", status: "done", detail: FACTORY_TOPIC });
    }
  }

  const protectionStepId = "branch_protection";
  const protection = await github.request(
    "GET",
    `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
  );
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
      return factoryError(
        "upstream_error",
        apply.error.message,
        protectionStepId,
        apply.error.retryable,
      );
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
    } else {
      return factoryError(
        "upstream_error",
        created.error.message,
        stepId,
        created.error.retryable,
      );
    }
  }

  let protectionOk = false;
  let bootstrapPending = false;
  const deadline = Date.now() + BOOTSTRAP_WAIT_MS;
  while (Date.now() < deadline) {
    const readme = await github.request("GET", `/repos/${repoFull}/contents/README.md`);
    const wrangler = await github.request(
      "GET",
      `/repos/${repoFull}/contents/wrangler.jsonc`,
    );
    const prot = await github.request(
      "GET",
      `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
    );
    const readmeOk =
      readme.ok &&
      readme.data &&
      typeof readme.data === "object" &&
      !JSON.stringify(readme.data).includes("{{");
    let wranglerOk = false;
    if (wrangler.ok && wrangler.data && typeof wrangler.data === "object") {
      const content = (wrangler.data as { content?: string }).content;
      if (content) {
        const decoded = atob(content.replace(/\n/g, ""));
        wranglerOk =
          decoded.includes(`"name": "${input.name}"`) ||
          decoded.includes(`"name":"${input.name}"`);
      }
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
    status = factoryOwned ? "repaired" : "created";
  } else if (factoryOwned || repoExists) {
    status = "exists";
  } else {
    status = "created";
  }

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

  writeAuditEntry({
    request_id: ctx.requestId,
    caller: ctx.caller,
    tool: "create_project_repo",
    dry_run: false,
    input: {
      name: input.name,
      description: input.description,
      private: isPrivate,
      approval_ref: input.approval_ref,
    },
    approval_ref: input.approval_ref,
    status,
    resources: { repo_url: repoUrl },
    duration_ms: Date.now() - started,
  });

  return result;
}
