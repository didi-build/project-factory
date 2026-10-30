import type { CloudflareDryRunRead } from "../cloudflare/dry-run-reads.js";
import { cloudflareDryRunReads } from "../cloudflare/dry-run-reads.js";
import type { ProjectFactoryEnv } from "../env.js";
import {
  branchProtectionReportedOk,
  protectionLooksCorrect,
} from "../factory/branch-protection.js";
import { DEFAULT_BRANCH, FACTORY_TOPIC } from "../factory/constants.js";
import { STANDARD_FACTORY_LABELS, standardLabelNames } from "../factory/labels.js";
import { GitHubAppClient } from "../github/app-client.js";
import {
  DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
  installationGet,
  mintDryRunInstallationToken,
} from "../github/dry-run-installation.js";
import { MISSING_GITHUB_APP_SECRET_MESSAGE } from "../github/github-errors.js";
import type { FactoryError, FactoryStep } from "./types.js";

export type GithubDryRunDiscovery = {
  installation?: {
    id: number;
    account_login?: string;
    repository_selection?: string;
    suspended_at?: string | null;
  };
  installation_read_ok: boolean;
  installation_error?: string;
  github_installation_token_minted: boolean;
  github_installation_token_permissions?: typeof DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS;
  repo_exists: boolean | null;
  factory_owned: boolean | null;
  conflict_not_factory_owned: boolean;
  protection_ok: boolean | null;
};

export type DryRunPlan = {
  status: "planned" | "conflict";
  dry_run: true;
  steps: FactoryStep[];
  warnings: string[];
  repo_url: string;
  default_branch: typeof DEFAULT_BRANCH;
  labels: string[];
  protection_ok: boolean | null;
  github: GithubDryRunDiscovery;
  cloudflare: CloudflareDryRunRead;
};

export type DryRunPlanBuildResult =
  { ok: true; plan: DryRunPlan } | { ok: false; error: FactoryError["error"] };

export async function buildCreateProjectRepoDryRunPlan(
  env: ProjectFactoryEnv,
  input: {
    name: string;
    org: string;
    templateRepo: string;
    isPrivate: boolean;
  },
  deps?: {
    fetchImpl?: typeof fetch;
    appClient?: GitHubAppClient;
  },
): Promise<DryRunPlanBuildResult> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const repoFull = `${input.org}/${input.name}`;
  const repoUrl = `https://github.com/${repoFull}`;
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];

  steps.push({
    id: "create_repo",
    status: "planned",
    detail: `generate or converge ${repoFull} from ${input.templateRepo}`,
  });
  steps.push({ id: "set_topic", status: "planned", detail: FACTORY_TOPIC });
  steps.push({
    id: "branch_protection",
    status: "planned",
    detail: `protect ${DEFAULT_BRANCH}`,
  });
  for (const label of STANDARD_FACTORY_LABELS) {
    steps.push({ id: `label_${label.name}`, status: "planned", detail: label.name });
  }
  steps.push({
    id: "verify_readme_placeholders",
    status: "planned",
    detail: "unknown without contents read permission",
  });
  steps.push({
    id: "verify_wrangler_name",
    status: "planned",
    detail: "unknown without contents read permission",
  });

  const github: GithubDryRunDiscovery = {
    installation_read_ok: false,
    github_installation_token_minted: false,
    repo_exists: null,
    factory_owned: null,
    conflict_not_factory_owned: false,
    protection_ok: null,
  };

  let protectionOk: boolean | null = null;

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
      const data = installation.data as {
        id?: number;
        account?: { login?: string };
        repository_selection?: string;
        suspended_at?: string | null;
      };
      github.installation = {
        id: data.id ?? Number(env.PROJECT_FACTORY_GH_INSTALLATION_ID),
        account_login: data.account?.login,
        repository_selection: data.repository_selection,
        suspended_at: data.suspended_at ?? null,
      };
      steps.push({
        id: "read_installation",
        status: "done",
        detail: `installation ${github.installation.id} for ${github.installation.account_login ?? "unknown account"}`,
      });
    } else {
      if (installation.code === "missing_secret") {
        return {
          ok: false,
          error: {
            code: "missing_secret",
            message: MISSING_GITHUB_APP_SECRET_MESSAGE,
          },
        };
      }
      github.installation_error = installation.message;
      warnings.push(`GitHub installation GET failed: ${installation.message}`);
      steps.push({
        id: "read_installation",
        status: "failed",
        detail: installation.message,
      });
    }

    const mint = await mintDryRunInstallationToken({
      appId: env.PROJECT_FACTORY_GH_APP_ID,
      installationId: env.PROJECT_FACTORY_GH_INSTALLATION_ID,
      privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
      fetchImpl,
    });
    if (!mint.ok) {
      if (mint.code === "missing_secret") {
        return {
          ok: false,
          error: {
            code: "missing_secret",
            message: MISSING_GITHUB_APP_SECRET_MESSAGE,
          },
        };
      }
      warnings.push(`installation token mint failed: ${mint.message}`);
      steps.push({
        id: "mint_installation_token",
        status: "failed",
        detail: mint.message,
      });
    } else {
      github.github_installation_token_minted = true;
      github.github_installation_token_permissions =
        DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS;
      steps.push({
        id: "mint_installation_token",
        status: "done",
        detail: "read-only permissions for dry run GETs",
      });

      const token = mint.token;
      const repo = await installationGet(token, `/repos/${repoFull}`, fetchImpl);
      if (!repo.ok) {
        if (repo.status === 404) {
          github.repo_exists = false;
          github.factory_owned = false;
          github.conflict_not_factory_owned = false;
          github.protection_ok = false;
          protectionOk = false;
          steps.push({ id: "read_repo", status: "done", detail: "not found" });
        } else {
          warnings.push(`GET /repos/${repoFull} failed: ${repo.message}`);
          steps.push({ id: "read_repo", status: "failed", detail: repo.message });
          github.repo_exists = null;
          github.factory_owned = null;
        }
      } else {
        github.repo_exists = true;
        steps.push({ id: "read_repo", status: "done", detail: repoUrl });

        const topics = await installationGet(
          token,
          `/repos/${repoFull}/topics`,
          fetchImpl,
        );
        if (!topics.ok) {
          warnings.push(`GET topics failed: ${topics.message}`);
          github.factory_owned = null;
          github.conflict_not_factory_owned = false;
          steps.push({
            id: "read_topics",
            status: "failed",
            detail: topics.message,
          });
        } else {
          const topicNames =
            topics.data && typeof topics.data === "object"
              ? ((topics.data as { names?: string[] }).names ?? [])
              : [];
          github.factory_owned = topicNames.includes(FACTORY_TOPIC);
          github.conflict_not_factory_owned =
            github.repo_exists === true && github.factory_owned === false;
          steps.push({
            id: "read_topics",
            status: "done",
            detail: github.factory_owned ? FACTORY_TOPIC : "no factory marker",
          });
        }

        const protection = await installationGet(
          token,
          `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
          fetchImpl,
        );
        if (protection.ok) {
          protectionOk = protectionLooksCorrect(
            protection.data as Record<string, unknown>,
          );
          github.protection_ok = protectionOk;
          steps.push({
            id: "read_branch_protection",
            status: "done",
            detail: protectionOk ? "matches target" : "drift detected",
          });
        } else if (protection.status === 404) {
          github.protection_ok = false;
          protectionOk = false;
          steps.push({
            id: "read_branch_protection",
            status: "done",
            detail: "not configured",
          });
        } else {
          github.protection_ok = null;
          protectionOk = null;
          warnings.push(`GET branch protection failed: ${protection.message}`);
          steps.push({
            id: "read_branch_protection",
            status: "failed",
            detail: protection.message,
          });
        }
      }
    }
  }

  const cloudflare = await cloudflareDryRunReads(env, input.name, fetchImpl);
  if (cloudflare.skipped) {
    warnings.push(cloudflare.skipped);
  } else if (cloudflare.error) {
    warnings.push(cloudflare.error);
  } else {
    steps.push({
      id: "read_cloudflare_worker",
      status: "done",
      detail: `worker ${input.name} exists=${String(cloudflare.worker_exists)}`,
    });
  }

  const planStatus = github.conflict_not_factory_owned ? "conflict" : "planned";
  if (github.conflict_not_factory_owned) {
    warnings.push(
      "Repository exists without the project-factory topic; dry run will not create or modify it",
    );
  }

  return {
    ok: true,
    plan: {
      status: planStatus,
      dry_run: true,
      steps,
      warnings,
      repo_url: repoUrl,
      default_branch: DEFAULT_BRANCH,
      labels: standardLabelNames(),
      protection_ok: protectionOk,
      github,
      cloudflare,
    },
  };
}

export type CreateProjectRepoDryRunSummary = {
  branch_protection_ok: boolean;
};

/** Fail-closed summary for dry-run consumers (null protection_ok is not OK). */
export function summarizeCreateProjectRepoDryRunPlan(
  plan: Pick<DryRunPlan, "protection_ok">,
): CreateProjectRepoDryRunSummary {
  return {
    branch_protection_ok: branchProtectionReportedOk(plan.protection_ok),
  };
}
