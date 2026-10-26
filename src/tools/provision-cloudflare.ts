import { CloudflareFactoryClient } from "../cloudflare/client.js";
import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry, writeTokenMintAudit } from "../factory/audit.js";
import { FACTORY_TOPIC } from "../factory/constants.js";
import {
  deployTokenName,
  ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
  previewWorkerName,
  productionWorkerName,
  REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
  REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
  workerSubdomainUrl,
} from "../factory/provision-constants.js";
import { validateProjectName } from "../factory/naming.js";
import { GitHubClient } from "../github/client.js";
import {
  ensureGithubEnvironment,
  resolveGithubUserId,
} from "../github/environments.js";
import { mapGithubFailure } from "../github/github-errors.js";
import { PROVISION_INSTALLATION_TOKEN_PERMISSIONS } from "../github/provision-permissions.js";
import {
  environmentSecretExists,
  putEnvironmentSecret,
  putRepoSecret,
  repoSecretExists,
} from "../github/secrets.js";
import { buildProvisionCloudflareDryRunPlan } from "./provision-cloudflare-dry-run-plan.js";
import type { FactoryError, FactoryStep, FactorySuccess } from "./types.js";

export type ProvisionCloudflareInput = {
  name: string;
  approval_ref: string;
  dry_run?: boolean;
};

export type ProvisionCloudflareContext = {
  env: ProjectFactoryEnv;
  requestId: string;
  caller: string;
  github?: GitHubClient;
  cloudflare?: CloudflareFactoryClient;
  fetchImpl?: typeof fetch;
};

function factoryError(
  code: string,
  message: string,
  step?: string,
  retryable = false,
): FactoryError {
  return { error: { code, message, step, retryable } };
}

async function readFactoryTopics(
  github: GitHubClient,
  repoFull: string,
): Promise<{ ok: true; factoryOwned: boolean } | { ok: false; error: FactoryError }> {
  const topicsResult = await github.request("GET", `/repos/${repoFull}/topics`);
  if (!topicsResult.ok) {
    if (topicsResult.error.status === 404) {
      return { ok: true, factoryOwned: false };
    }
    return { ok: false, error: mapGithubFailure(topicsResult.error, "read_topics") };
  }
  const names =
    topicsResult.data && typeof topicsResult.data === "object"
      ? ((topicsResult.data as { names?: string[] }).names ?? [])
      : [];
  return { ok: true, factoryOwned: names.includes(FACTORY_TOPIC) };
}

export async function provisionCloudflare(
  ctx: ProvisionCloudflareContext,
  input: ProvisionCloudflareInput,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const dryRun = input.dry_run !== false;
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
  const prodWorker = productionWorkerName(input.name);
  const prevWorker = previewWorkerName(input.name);
  const repoUrl = `https://github.com/${repoFull}`;

  const finishAudit = (resources?: Record<string, string | undefined>) => {
    writeAuditEntry({
      request_id: ctx.requestId,
      caller: ctx.caller,
      tool: "provision_cloudflare",
      dry_run: dryRun,
      input: {
        name: input.name,
        approval_ref: input.approval_ref,
      },
      approval_ref: input.approval_ref,
      status: auditStatus,
      resources: {
        repo_url: repoUrl,
        worker_url: resources?.worker_url,
        preview_worker_url: resources?.preview_worker_url,
      },
      duration_ms: Date.now() - started,
      steps: auditExtras.steps ?? (steps.length > 0 ? [...steps] : undefined),
      failed_step: failedStep,
      github_installation_token_minted: auditExtras.github_installation_token_minted,
      github_installation_token_permissions:
        auditExtras.github_installation_token_permissions,
    });
  };

  let workerUrl = "";
  let previewWorkerUrl = "";
  const repoSecretsSet: string[] = [];
  const environmentSecretsSet: string[] = [];

  try {
    const nameCheck = validateProjectName(input.name);
    if (!nameCheck.ok) {
      auditStatus = nameCheck.code;
      return factoryError(nameCheck.code, nameCheck.message);
    }
    if (!input.approval_ref?.trim()) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", "approval_ref is required");
    }

    if (
      !ctx.env.PROJECT_FACTORY_GH_APP_ID ||
      !ctx.env.PROJECT_FACTORY_GH_INSTALLATION_ID
    ) {
      auditStatus = "missing_secret";
      return factoryError("missing_secret", "PROJECT_FACTORY_GH_APP_ID");
    }

    if (dryRun) {
      const plan = await buildProvisionCloudflareDryRunPlan(
        ctx.env,
        { name: input.name, org },
        { fetchImpl: ctx.fetchImpl },
      );
      auditStatus = plan.status;
      auditExtras = {
        steps: plan.steps,
        github_installation_token_minted: plan.github.github_installation_token_minted,
        github_installation_token_permissions: plan.github
          .github_installation_token_minted
          ? { ...plan.github.github_installation_token_permissions }
          : undefined,
      };
      return { request_id: ctx.requestId, ...plan };
    }

    if (!ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
      auditStatus = "missing_secret";
      return factoryError("missing_secret", "PROJECT_FACTORY_GH_PRIVATE_KEY");
    }

    const cfClientResult = CloudflareFactoryClient.fromEnv(ctx.env, ctx.fetchImpl);
    if (!cfClientResult.ok) {
      auditStatus = "missing_secret";
      return factoryError("missing_secret", "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN");
    }
    const cloudflare = ctx.cloudflare ?? cfClientResult.client;

    const github =
      ctx.github ??
      new GitHubClient({
        appId: ctx.env.PROJECT_FACTORY_GH_APP_ID,
        installationId: ctx.env.PROJECT_FACTORY_GH_INSTALLATION_ID,
        privateKeyPem: ctx.env.PROJECT_FACTORY_GH_PRIVATE_KEY,
        fetchImpl: ctx.fetchImpl,
        installationTokenPermissions: {
          ...PROVISION_INSTALLATION_TOKEN_PERMISSIONS,
        },
      });
    auditExtras.github_installation_token_minted = true;
    auditExtras.github_installation_token_permissions = {
      ...PROVISION_INSTALLATION_TOKEN_PERMISSIONS,
    };

    const repo = await github.request("GET", `/repos/${repoFull}`);
    if (!repo.ok) {
      if (repo.error.status === 404) {
        auditStatus = "blocked";
        failedStep = "read_repo";
        return factoryError(
          "upstream_error",
          `repository ${repoFull} does not exist`,
          "read_repo",
        );
      }
      const mapped = mapGithubFailure(repo.error, "read_repo");
      auditStatus = mapped.error.code;
      failedStep = mapped.error.step;
      return mapped;
    }

    const topics = await readFactoryTopics(github, repoFull);
    if (!topics.ok) {
      auditStatus = topics.error.error.code;
      failedStep = topics.error.error.step;
      return topics.error;
    }
    if (!topics.factoryOwned) {
      auditStatus = "conflict_not_factory_owned";
      failedStep = "read_topics";
      return factoryError(
        "conflict_not_factory_owned",
        `repository ${repoFull} exists without the project-factory topic`,
        "read_topics",
      );
    }

    const subdomainResult = await cloudflare.getWorkersDevSubdomain();
    if (!subdomainResult.ok) {
      auditStatus = subdomainResult.error.error.code;
      failedStep = subdomainResult.error.error.step;
      return subdomainResult.error;
    }
    workerUrl = workerSubdomainUrl(prodWorker, subdomainResult.subdomain);
    previewWorkerUrl = workerSubdomainUrl(prevWorker, subdomainResult.subdomain);

    const accountResult = await cloudflare.resolveAccountId();
    if (!accountResult.ok) {
      auditStatus = accountResult.error.error.code;
      failedStep = accountResult.error.error.step;
      return accountResult.error;
    }
    const accountId = accountResult.accountId;

    let repaired = false;
    let created = false;

    for (const [stepId, workerName] of [
      ["worker_production", prodWorker],
      ["worker_preview", prevWorker],
    ] as const) {
      const ensured = await cloudflare.ensurePlaceholderWorker(workerName);
      if (!ensured.ok) {
        auditStatus = ensured.error.error.code;
        failedStep = stepId;
        return ensured.error;
      }
      if (ensured.created) {
        created = true;
        steps.push({ id: stepId, status: "done", detail: workerName });
      } else {
        steps.push({ id: stepId, status: "skipped", detail: workerName });
      }
    }

    let reviewerId: number | undefined;
    const reviewerLogin = ctx.env.PROJECT_FACTORY_GH_PRODUCTION_REVIEWER?.trim();
    if (reviewerLogin) {
      const resolved = await resolveGithubUserId(github, reviewerLogin);
      if (!resolved.ok) {
        auditStatus = resolved.error.error.code;
        failedStep = resolved.error.error.step;
        return resolved.error;
      }
      reviewerId = resolved.id;
    } else {
      warnings.push(
        "PROJECT_FACTORY_GH_PRODUCTION_REVIEWER not set; production environment created without reviewers",
      );
    }

    for (const envName of ["preview", "production"] as const) {
      const stepId = `github_environment_${envName}`;
      const ensured = await ensureGithubEnvironment(github, repoFull, envName, {
        productionReviewerId: envName === "production" ? reviewerId : undefined,
      });
      if (!ensured.ok) {
        auditStatus = ensured.error.error.code;
        failedStep = stepId;
        return ensured.error;
      }
      if (ensured.created) {
        repaired = true;
        steps.push({ id: stepId, status: "done", detail: envName });
      } else {
        steps.push({ id: stepId, status: "skipped", detail: envName });
      }
    }

    const previewSecretExists = await repoSecretExists(
      github,
      repoFull,
      REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
    );
    if (!previewSecretExists.ok) {
      auditStatus = previewSecretExists.error.error.code;
      failedStep = "check_preview_secret";
      return previewSecretExists.error;
    }

    const accountSecretExists = await repoSecretExists(
      github,
      repoFull,
      REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
    );
    if (!accountSecretExists.ok) {
      auditStatus = accountSecretExists.error.error.code;
      failedStep = "check_account_secret";
      return accountSecretExists.error;
    }

    const productionSecretExists = await environmentSecretExists(
      github,
      repoFull,
      "production",
      ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
    );
    if (!productionSecretExists.ok) {
      auditStatus = productionSecretExists.error.error.code;
      failedStep = "check_production_secret";
      return productionSecretExists.error;
    }

    if (!accountSecretExists.exists) {
      const put = await putRepoSecret(
        github,
        repoFull,
        REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
        accountId,
      );
      if (!put.ok) {
        auditStatus = put.error.error.code;
        failedStep = "put_account_secret";
        return put.error;
      }
      repoSecretsSet.push(REPO_SECRET_CLOUDFLARE_ACCOUNT_ID);
      repaired = true;
      steps.push({
        id: "secret_CLOUDFLARE_ACCOUNT_ID",
        status: "done",
        detail: REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
      });
    } else {
      repoSecretsSet.push(REPO_SECRET_CLOUDFLARE_ACCOUNT_ID);
      steps.push({
        id: "secret_CLOUDFLARE_ACCOUNT_ID",
        status: "skipped",
        detail: REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
      });
    }

    if (!previewSecretExists.exists) {
      const mint = await cloudflare.mintWorkerDeployToken(
        prevWorker,
        deployTokenName(input.name, "preview"),
      );
      if (!mint.ok) {
        auditStatus = mint.error.error.code;
        failedStep = "mint_preview_token";
        return mint.error;
      }
      writeTokenMintAudit({
        request_id: ctx.requestId,
        token_name: deployTokenName(input.name, "preview"),
        token_id: mint.tokenId,
      });
      const put = await putRepoSecret(
        github,
        repoFull,
        REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
        mint.tokenValue,
      );
      if (!put.ok) {
        auditStatus = put.error.error.code;
        failedStep = "put_preview_secret";
        return put.error;
      }
      created = true;
      repaired = true;
      repoSecretsSet.push(REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW);
      steps.push({
        id: "secret_CLOUDFLARE_API_TOKEN_PREVIEW",
        status: "done",
        detail: REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
      });
    } else {
      repoSecretsSet.push(REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW);
      steps.push({
        id: "secret_CLOUDFLARE_API_TOKEN_PREVIEW",
        status: "skipped",
        detail: REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
      });
    }

    if (!productionSecretExists.exists) {
      const mint = await cloudflare.mintWorkerDeployToken(
        prodWorker,
        deployTokenName(input.name, "production"),
      );
      if (!mint.ok) {
        auditStatus = mint.error.error.code;
        failedStep = "mint_production_token";
        return mint.error;
      }
      writeTokenMintAudit({
        request_id: ctx.requestId,
        token_name: deployTokenName(input.name, "production"),
        token_id: mint.tokenId,
      });
      const put = await putEnvironmentSecret(
        github,
        repoFull,
        "production",
        ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
        mint.tokenValue,
      );
      if (!put.ok) {
        auditStatus = put.error.error.code;
        failedStep = "put_production_secret";
        return put.error;
      }
      created = true;
      repaired = true;
      environmentSecretsSet.push(ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION);
      steps.push({
        id: "secret_CLOUDFLARE_API_TOKEN_PRODUCTION",
        status: "done",
        detail: ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
      });
    } else {
      environmentSecretsSet.push(ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION);
      steps.push({
        id: "secret_CLOUDFLARE_API_TOKEN_PRODUCTION",
        status: "skipped",
        detail: ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
      });
    }

    let status: string;
    if (created && !repaired) {
      status = "created";
    } else if (repaired && !created) {
      status = "repaired";
    } else if (created || repaired) {
      status = "repaired";
    } else {
      status = "exists";
    }

    auditStatus = status;
    return {
      request_id: ctx.requestId,
      status,
      steps,
      warnings,
      worker: { name: prodWorker, url: workerUrl },
      preview_worker: { name: prevWorker, url: previewWorkerUrl },
      preview_name_pattern: "pr-<n>",
      repo_secrets_set: repoSecretsSet.sort(),
      environment_secrets_set: environmentSecretsSet.sort(),
      dry_run: false,
    } as FactorySuccess & {
      worker: { name: string; url: string };
      preview_worker: { name: string; url: string };
      preview_name_pattern: string;
      repo_secrets_set: string[];
      environment_secrets_set: string[];
      dry_run: boolean;
    };
  } finally {
    finishAudit({
      worker_url: workerUrl || undefined,
      preview_worker_url: previewWorkerUrl || undefined,
    });
  }
}
