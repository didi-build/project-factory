import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import { protectionLooksCorrect } from "../factory/branch-protection.js";
import { DEFAULT_BRANCH, FACTORY_TOPIC } from "../factory/constants.js";
import { validateProjectName } from "../factory/naming.js";
import { GitHubClient } from "../github/client.js";
import type { FactoryError, FactorySuccess } from "./types.js";

export type ProjectStatusInput = {
  name: string;
};

export async function projectStatus(
  env: ProjectFactoryEnv,
  requestId: string,
  caller: string,
  input: ProjectStatusInput,
  github?: GitHubClient,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const nameCheck = validateProjectName(input.name);
  if (!nameCheck.ok) {
    return { error: { code: nameCheck.code, message: nameCheck.message } };
  }
  if (!env.PROJECT_FACTORY_GH_PRIVATE_KEY) {
    return {
      error: { code: "missing_secret", message: "PROJECT_FACTORY_GH_PRIVATE_KEY" },
    };
  }
  const org = env.PROJECT_FACTORY_GH_ORG;
  const repoFull = `${org}/${input.name}`;
  const client =
    github ??
    new GitHubClient({
      appId: env.PROJECT_FACTORY_GH_APP_ID,
      installationId: env.PROJECT_FACTORY_GH_INSTALLATION_ID,
      privateKeyPem: env.PROJECT_FACTORY_GH_PRIVATE_KEY,
    });

  const repo = await client.request("GET", `/repos/${repoFull}`);
  const githubState = repo.ok
    ? {
        exists: true,
        url: `https://github.com/${repoFull}`,
        factory_owned: false,
        protection_ok: false,
      }
    : { exists: false };

  if (repo.ok) {
    const topicsResult = await client.request("GET", `/repos/${repoFull}/topics`);
    const names =
      topicsResult.ok && topicsResult.data && typeof topicsResult.data === "object"
        ? ((topicsResult.data as { names?: string[] }).names ?? [])
        : [];
    githubState.factory_owned = names.includes(FACTORY_TOPIC);
    const prot = await client.request(
      "GET",
      `/repos/${repoFull}/branches/${DEFAULT_BRANCH}/protection`,
    );
    githubState.protection_ok =
      prot.ok && protectionLooksCorrect(prot.data as Record<string, unknown>);
  }

  const status = "done";
  writeAuditEntry({
    request_id: requestId,
    caller,
    tool: "project_status",
    dry_run: true,
    input: { name: input.name },
    status,
    resources: {
      repo_url: githubState.exists ? `https://github.com/${repoFull}` : undefined,
    },
    duration_ms: Date.now() - started,
  });

  return {
    request_id: requestId,
    status,
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
}
