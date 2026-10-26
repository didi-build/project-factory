import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import { protectionLooksCorrect } from "../factory/branch-protection.js";
import { DEFAULT_BRANCH, FACTORY_TOPIC } from "../factory/constants.js";
import { validateProjectName } from "../factory/naming.js";
import {
  installationGet,
  mintDryRunInstallationToken,
} from "../github/dry-run-installation.js";
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
      auditStatus = mint.status === 401 ? "missing_secret" : "upstream_error";
      return {
        error: {
          code: auditStatus,
          message: mint.message,
          retryable: mint.status >= 500,
        },
      };
    }

    const repo = await installationGet(mint.token, `/repos/${repoFull}`, fetchImpl);
    const githubState = repo.ok
      ? {
          exists: true,
          url: `https://github.com/${repoFull}`,
          factory_owned: false,
          protection_ok: false,
        }
      : { exists: false };

    if (repo.ok) {
      const topicsResult = await installationGet(
        mint.token,
        `/repos/${repoFull}/topics`,
        fetchImpl,
      );
      const names =
        topicsResult.ok && topicsResult.data && typeof topicsResult.data === "object"
          ? ((topicsResult.data as { names?: string[] }).names ?? [])
          : [];
      githubState.factory_owned = names.includes(FACTORY_TOPIC);
      const prot = await installationGet(
        mint.token,
        `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
        fetchImpl,
      );
      githubState.protection_ok =
        prot.ok && protectionLooksCorrect(prot.data as Record<string, unknown>);
    }

    auditStatus = "done";
    return {
      request_id: requestId,
      status: auditStatus,
      steps: [{ id: "project_status", status: "done" }],
      warnings: [],
      github: githubState,
      linear: { configured: false },
      cloudflare: { configured: false },
    } as FactorySuccess & {
      github: typeof githubState;
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
