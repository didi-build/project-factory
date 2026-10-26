import type { CloudflareDryRunRead } from "../cloudflare/dry-run-reads.js";
import { cloudflareDryRunReads } from "../cloudflare/dry-run-reads.js";
import type { ProjectFactoryEnv } from "../env.js";
import { DEFAULT_BRANCH, FACTORY_TOPIC } from "../factory/constants.js";
import { STANDARD_FACTORY_LABELS, standardLabelNames } from "../factory/labels.js";
import {
  GitHubAppClient,
  installationScopedRepoReads,
  type BlockedInstallationRead,
} from "../github/app-client.js";
import type { FactoryStep } from "./types.js";

export type GithubDryRunDiscovery = {
  installation?: {
    id: number;
    account_login?: string;
    repository_selection?: string;
    suspended_at?: string | null;
  };
  installation_read_ok: boolean;
  installation_error?: string;
  reads_requiring_installation_token: BlockedInstallationRead[];
  repo_exists: null;
  factory_owned: null;
  conflict_not_factory_owned: null;
};

export type DryRunPlan = {
  status: "planned";
  dry_run: true;
  steps: FactoryStep[];
  warnings: string[];
  repo_url: string;
  default_branch: typeof DEFAULT_BRANCH;
  labels: string[];
  protection_ok: false;
  github: GithubDryRunDiscovery;
  cloudflare: CloudflareDryRunRead;
};

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
): Promise<DryRunPlan> {
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

  const readsRequiringInstallationToken = installationScopedRepoReads(
    input.org,
    input.name,
  );

  const github: GithubDryRunDiscovery = {
    installation_read_ok: false,
    reads_requiring_installation_token: readsRequiringInstallationToken,
    repo_exists: null,
    factory_owned: null,
    conflict_not_factory_owned: null,
  };

  if (!env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
    warnings.push(
      "PROJECT_FACTORY_GH_PRIVATE_KEY not set; skipped GitHub App installation GET",
    );
  } else if (
    !env.PROJECT_FACTORY_GH_APP_ID ||
    !env.PROJECT_FACTORY_GH_INSTALLATION_ID
  ) {
    warnings.push("GitHub App vars missing; skipped GitHub App installation GET");
  } else {
    const app =
      deps?.appClient ??
      new GitHubAppClient({
        appId: env.PROJECT_FACTORY_GH_APP_ID,
        privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
        fetchImpl: deps?.fetchImpl,
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
      github.installation_error = installation.message;
      warnings.push(`GitHub installation GET failed: ${installation.message}`);
      steps.push({
        id: "read_installation",
        status: "failed",
        detail: installation.message,
      });
    }

    warnings.push(
      "Repo collision checks need an installation access token. Dry run does not call POST /app/installations/{installation_id}/access_tokens. Use the reads_requiring_installation_token list for required GET paths.",
    );
    for (const read of readsRequiringInstallationToken) {
      steps.push({
        id: `blocked_${read.path.replace(/\//g, "_")}`,
        status: "planned",
        detail: `${read.method} ${read.path} (${read.reason})`,
      });
    }
  }

  const cloudflare = await cloudflareDryRunReads(
    env,
    input.name,
    deps?.fetchImpl ?? fetch,
  );
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

  return {
    status: "planned",
    dry_run: true,
    steps,
    warnings,
    repo_url: repoUrl,
    default_branch: DEFAULT_BRANCH,
    labels: standardLabelNames(),
    protection_ok: false,
    github,
    cloudflare,
  };
}
