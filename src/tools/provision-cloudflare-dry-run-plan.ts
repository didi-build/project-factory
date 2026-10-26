import { provisionWorkersDryRunReads } from "../cloudflare/dry-run-reads.js";
import type { ProjectFactoryEnv } from "../env.js";
import { FACTORY_TOPIC } from "../factory/constants.js";
import {
  ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
  GITHUB_ENV_PREVIEW,
  GITHUB_ENV_PRODUCTION,
  PREVIEW_NAME_PATTERN,
  previewWorkerName,
  productionWorkerName,
  REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
  REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
} from "../factory/provision-constants.js";
import { GitHubAppClient } from "../github/app-client.js";
import {
  installationGet,
  mintDryRunInstallationToken,
} from "../github/dry-run-installation.js";
import { PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS } from "../github/provision-permissions.js";
import type { FactoryStep } from "./types.js";

export type ProvisionGithubDryRunDiscovery = {
  installation_read_ok: boolean;
  installation_error?: string;
  github_installation_token_minted: boolean;
  github_installation_token_permissions?: typeof PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS;
  repo_exists: boolean | null;
  factory_owned: boolean | null;
  conflict_not_factory_owned: boolean;
  repo_secret_names?: string[];
  environment_names?: string[];
  production_environment_secret_names?: string[];
};

export type ProvisionDryRunPlan = {
  status: "planned" | "conflict" | "blocked";
  dry_run: true;
  steps: FactoryStep[];
  warnings: string[];
  worker: { name: string; url: string };
  preview_worker: { name: string; url: string };
  preview_name_pattern: typeof PREVIEW_NAME_PATTERN;
  repo_secrets_set: string[];
  environment_secrets_set: string[];
  github: ProvisionGithubDryRunDiscovery;
  cloudflare: Awaited<ReturnType<typeof provisionWorkersDryRunReads>>;
};

export async function buildProvisionCloudflareDryRunPlan(
  env: ProjectFactoryEnv,
  input: { name: string; org: string; accountSubdomain?: string },
  deps?: { fetchImpl?: typeof fetch; appClient?: GitHubAppClient },
): Promise<ProvisionDryRunPlan> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const repoFull = `${input.org}/${input.name}`;
  const prodWorker = productionWorkerName(input.name);
  const prevWorker = previewWorkerName(input.name);
  const subdomain = input.accountSubdomain ?? "workers";
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];

  steps.push({
    id: "worker_production",
    status: "planned",
    detail: `ensure Worker ${prodWorker}`,
  });
  steps.push({
    id: "worker_preview",
    status: "planned",
    detail: `ensure Worker ${prevWorker}`,
  });
  steps.push({
    id: "github_environment_preview",
    status: "planned",
    detail: GITHUB_ENV_PREVIEW,
  });
  steps.push({
    id: "github_environment_production",
    status: "planned",
    detail: GITHUB_ENV_PRODUCTION,
  });
  steps.push({
    id: "mint_deploy_tokens",
    status: "planned",
    detail: "Worker-scoped Editor tokens (production and preview)",
  });
  steps.push({
    id: "github_secrets",
    status: "planned",
    detail: `${REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW}, ${REPO_SECRET_CLOUDFLARE_ACCOUNT_ID}`,
  });
  steps.push({
    id: "github_environment_secret_production",
    status: "planned",
    detail: ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
  });

  const github: ProvisionGithubDryRunDiscovery = {
    installation_read_ok: false,
    github_installation_token_minted: false,
    repo_exists: null,
    factory_owned: null,
    conflict_not_factory_owned: false,
  };

  let repoSecretsSet: string[] = [];
  let environmentSecretsSet: string[] = [];

  if (!env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
    warnings.push(
      "PROJECT_FACTORY_GH_PRIVATE_KEY not set; skipped GitHub installation reads",
    );
  } else if (
    !env.PROJECT_FACTORY_GH_APP_ID ||
    !env.PROJECT_FACTORY_GH_INSTALLATION_ID
  ) {
    warnings.push("GitHub App vars missing; skipped GitHub installation reads");
  } else {
    const app =
      deps?.appClient ??
      new GitHubAppClient({
        appId: env.PROJECT_FACTORY_GH_APP_ID,
        privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
        fetchImpl,
      });
    const installation = await app.get(
      `/app/installations/${env.PROJECT_FACTORY_GH_INSTALLATION_ID}`,
    );
    if (installation.ok) {
      github.installation_read_ok = true;
      steps.push({
        id: "read_installation",
        status: "done",
        detail: `installation ${env.PROJECT_FACTORY_GH_INSTALLATION_ID}`,
      });
    } else {
      github.installation_error = installation.message;
      warnings.push(`GitHub installation GET failed: ${installation.message}`);
    }

    const mint = await mintDryRunInstallationToken({
      appId: env.PROJECT_FACTORY_GH_APP_ID,
      installationId: env.PROJECT_FACTORY_GH_INSTALLATION_ID,
      privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
      fetchImpl,
      permissions: PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
    });
    if (!mint.ok) {
      warnings.push(`installation token mint failed: ${mint.message}`);
    } else {
      github.github_installation_token_minted = true;
      github.github_installation_token_permissions =
        PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS;
      const token = mint.token;
      const repo = await installationGet(token, `/repos/${repoFull}`, fetchImpl);
      if (!repo.ok) {
        if (repo.status === 404) {
          github.repo_exists = false;
          github.factory_owned = false;
          steps.push({ id: "read_repo", status: "done", detail: "not found" });
        } else {
          warnings.push(`GET /repos/${repoFull} failed: ${repo.message}`);
          github.repo_exists = null;
        }
      } else {
        github.repo_exists = true;
        const topics = await installationGet(
          token,
          `/repos/${repoFull}/topics`,
          fetchImpl,
        );
        if (!topics.ok) {
          warnings.push(`GET topics failed: ${topics.message}`);
        } else {
          const topicNames =
            topics.data && typeof topics.data === "object"
              ? ((topics.data as { names?: string[] }).names ?? [])
              : [];
          github.factory_owned = topicNames.includes(FACTORY_TOPIC);
          github.conflict_not_factory_owned =
            github.repo_exists === true && github.factory_owned === false;
        }

        const secrets = await installationGet(
          token,
          `/repos/${repoFull}/actions/secrets`,
          fetchImpl,
        );
        if (secrets.ok && secrets.data && typeof secrets.data === "object") {
          const names = (
            (secrets.data as { secrets?: { name: string }[] }).secrets ?? []
          ).map((s) => s.name);
          github.repo_secret_names = names.sort();
          repoSecretsSet = names.filter((n) =>
            [
              REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
              REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
            ].includes(n),
          );
        } else if (!secrets.ok) {
          warnings.push(`GET repo secrets failed: ${secrets.message}`);
        }

        const envs = await installationGet(
          token,
          `/repos/${repoFull}/environments`,
          fetchImpl,
        );
        if (envs.ok && envs.data && typeof envs.data === "object") {
          const names = (
            (envs.data as { environments?: { name: string }[] }).environments ?? []
          ).map((e) => e.name);
          github.environment_names = names.sort();
        } else if (!envs.ok) {
          warnings.push(`GET environments failed: ${envs.message}`);
        }

        const prodSecrets = await installationGet(
          token,
          `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}/secrets`,
          fetchImpl,
        );
        if (
          prodSecrets.ok &&
          prodSecrets.data &&
          typeof prodSecrets.data === "object"
        ) {
          const names = (
            (prodSecrets.data as { secrets?: { name: string }[] }).secrets ?? []
          ).map((s) => s.name);
          github.production_environment_secret_names = names.sort();
          environmentSecretsSet = names.filter(
            (n) => n === ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
          );
        } else if (!prodSecrets.ok && prodSecrets.status === 404) {
          github.production_environment_secret_names = [];
        } else if (!prodSecrets.ok) {
          warnings.push(
            `GET production environment secrets failed: ${prodSecrets.message}`,
          );
        }
      }
    }
  }

  const cloudflare = await provisionWorkersDryRunReads(
    env,
    prodWorker,
    prevWorker,
    fetchImpl,
  );
  warnings.push(...cloudflare.warnings);
  if (cloudflare.production.worker_exists !== undefined) {
    steps.push({
      id: "read_cloudflare_worker_production",
      status: cloudflare.production.error ? "failed" : "done",
      detail: `exists=${String(cloudflare.production.worker_exists)}`,
    });
  }
  if (cloudflare.preview.worker_exists !== undefined) {
    steps.push({
      id: "read_cloudflare_worker_preview",
      status: cloudflare.preview.error ? "failed" : "done",
      detail: `exists=${String(cloudflare.preview.worker_exists)}`,
    });
  }

  let status: ProvisionDryRunPlan["status"] = "planned";
  if (github.conflict_not_factory_owned) {
    status = "conflict";
    warnings.push(
      "Repository exists without the project-factory topic; dry run will not modify it",
    );
  } else if (github.repo_exists === false) {
    status = "blocked";
    warnings.push("Repository does not exist; run create_project_repo first");
  }

  return {
    status,
    dry_run: true,
    steps,
    warnings,
    worker: {
      name: prodWorker,
      url: `https://${prodWorker}.${subdomain}.workers.dev`,
    },
    preview_worker: {
      name: prevWorker,
      url: `https://${prevWorker}.${subdomain}.workers.dev`,
    },
    preview_name_pattern: PREVIEW_NAME_PATTERN,
    repo_secrets_set: repoSecretsSet,
    environment_secrets_set: environmentSecretsSet,
    github,
    cloudflare,
  };
}
