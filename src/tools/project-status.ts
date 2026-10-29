import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import { protectionLooksCorrect } from "../factory/branch-protection.js";
import { DEFAULT_BRANCH, FACTORY_TOPIC } from "../factory/constants.js";
import { validateProjectName } from "../factory/naming.js";
import {
  installationGet,
  mintDryRunInstallationToken,
} from "../github/dry-run-installation.js";
import { mapMintDryRunFailure } from "../github/github-errors.js";
import type { FactoryError, FactorySuccess } from "./types.js";

export type ProjectStatusInput = {
  name: string;
};

export type ProjectStatusDeps = {
  fetchImpl?: typeof fetch;
};

export async function projectStatus(
  env: ProjectFactoryEnv,
  requestId: string,
  caller: string,
  input: ProjectStatusInput,
  deps?: ProjectStatusDeps,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let auditStatus = "started";
  const org = env.PROJECT_FACTORY_GH_ORG;
  const repoFull = `${org}/${input.name}`;
  const warnings: string[] = [];

  try {
    const nameCheck = validateProjectName(input.name);
    if (!nameCheck.ok) {
      auditStatus = nameCheck.code;
      return { error: { code: nameCheck.code, message: nameCheck.message } };
    }
    if (!env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
      auditStatus = "missing_secret";
      return {
        error: { code: "missing_secret", message: "PROJECT_FACTORY_GH_PRIVATE_KEY" },
      };
    }
    if (!env.PROJECT_FACTORY_GH_APP_ID || !env.PROJECT_FACTORY_GH_INSTALLATION_ID) {
      auditStatus = "missing_secret";
      return {
        error: {
          code: "missing_secret",
          message: "PROJECT_FACTORY_GH_APP_ID or PROJECT_FACTORY_GH_INSTALLATION_ID",
        },
      };
    }

    const mint = await mintDryRunInstallationToken({
      appId: env.PROJECT_FACTORY_GH_APP_ID,
      installationId: env.PROJECT_FACTORY_GH_INSTALLATION_ID,
      privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
      fetchImpl,
    });
    if (!mint.ok) {
      const mapped = mapMintDryRunFailure(mint);
      auditStatus = mapped.code;
      return {
        error: {
          code: mapped.code,
          message: mapped.message,
          retryable: mapped.retryable,
        },
      };
    }

    const repo = await installationGet(mint.token, `/repos/${repoFull}`, fetchImpl);
    type GithubState = {
      exists: boolean | null;
      url?: string;
      factory_owned: boolean | null;
      protection_ok: boolean | null;
    };
    const githubState: GithubState = {
      exists: null,
      factory_owned: null,
      protection_ok: null,
    };

    if (!repo.ok) {
      if (repo.status === 404) {
        githubState.exists = false;
      } else {
        warnings.push(`GET /repos/${repoFull} failed: ${repo.message}`);
        githubState.exists = null;
      }
    } else {
      githubState.exists = true;
      githubState.url = `https://github.com/${repoFull}`;
      githubState.factory_owned = false;
      githubState.protection_ok = false;

      const topicsResult = await installationGet(
        mint.token,
        `/repos/${repoFull}/topics`,
        fetchImpl,
      );
      if (!topicsResult.ok) {
        warnings.push(`GET topics failed: ${topicsResult.message}`);
        githubState.factory_owned = null;
      } else {
        const names =
          topicsResult.data && typeof topicsResult.data === "object"
            ? ((topicsResult.data as { names?: string[] }).names ?? [])
            : [];
        githubState.factory_owned = names.includes(FACTORY_TOPIC);
      }

      const prot = await installationGet(
        mint.token,
        `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
        fetchImpl,
      );
      if (prot.ok) {
        githubState.protection_ok = protectionLooksCorrect(
          prot.data as Record<string, unknown>,
        );
      } else if (prot.status === 404) {
        githubState.protection_ok = false;
      } else {
        warnings.push(`GET branch protection failed: ${prot.message}`);
        githubState.protection_ok = null;
      }
    }

    auditStatus = "done";
    return {
      request_id: requestId,
      status: auditStatus,
      steps: [{ id: "project_status", status: "done" }],
      warnings,
      github: githubState,
      linear: { configured: false },
      cloudflare: { configured: false },
    } as FactorySuccess & {
      github: GithubState;
      linear: { configured: boolean };
      cloudflare: { configured: boolean };
    };
  } finally {
    writeAuditEntry({
      request_id: requestId,
      caller,
      tool: "project_status",
      dry_run: true,
      input: { name: input.name },
      status: auditStatus,
      resources: {
        repo_url: `https://github.com/${repoFull}`,
      },
      duration_ms: Date.now() - started,
    });
  }
}
