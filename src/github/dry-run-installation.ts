import type { GitHubError } from "./client.js";
import { createGitHubAppJwt } from "./jwt.js";
import { githubResponseFailure, trimmedHttpDetail } from "./github-errors.js";

export const DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
} as const;

export type DryRunMintResult =
  { ok: true; token: string } | ({ ok: false } & GitHubError);

export async function mintDryRunInstallationToken(options: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
}): Promise<DryRunMintResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let jwt: string;
  try {
    jwt = await createGitHubAppJwt(options.appId, options.privateKeyPem);
  } catch {
    return {
      ok: false,
      status: 401,
      code: "missing_secret",
      message: trimmedHttpDetail(401, "missing_secret"),
      retryable: false,
    };
  }
  const response = await fetchImpl(
    `https://api.github.com/app/installations/${options.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        permissions: DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
      }),
    },
  );
  if (!response.ok) {
    const failure = await githubResponseFailure(response);
    return { ok: false, ...failure };
  }
  const data = (await response.json()) as { token: string };
  return { ok: true, token: data.token };
}

export type InstallationGetResult =
  { ok: true; data: unknown } | ({ ok: false } & GitHubError);

export async function installationGet(
  token: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallationGetResult> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const failure = await githubResponseFailure(response);
    return { ok: false, ...failure };
  }
  const text = await response.text();
  return { ok: true, data: text ? JSON.parse(text) : null };
}
