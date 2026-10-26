import { createGitHubAppJwt } from "./jwt.js";

export const DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
} as const;

export type DryRunMintResult =
  { ok: true; token: string } | { ok: false; status: number; message: string };

export async function mintDryRunInstallationToken(options: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
  permissions?: Record<string, string>;
}): Promise<DryRunMintResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let jwt: string;
  try {
    jwt = await createGitHubAppJwt(options.appId, options.privateKeyPem);
  } catch {
    return { ok: false, status: 401, message: "invalid GitHub app private key" };
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
        permissions: options.permissions ?? DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
      }),
    },
  );
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // ignore
    }
    return { ok: false, status: response.status, message };
  }
  const data = (await response.json()) as { token: string };
  return { ok: true, token: data.token };
}

export async function installationGet(
  token: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; data: unknown } | { ok: false; status: number; message: string }
> {
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
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      message = body.message ?? message;
    } catch {
      // ignore
    }
    return { ok: false, status: response.status, message };
  }
  const text = await response.text();
  return { ok: true, data: text ? JSON.parse(text) : null };
}
