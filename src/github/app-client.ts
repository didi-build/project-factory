import { createGitHubAppJwt } from "./jwt.js";

export type GitHubAppClientOptions = {
  appId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
};

export type GitHubAppGetResult =
  | { ok: true; data: unknown; status: number }
  | { ok: false; status: number; message: string };

export class GitHubAppClient {
  private jwt: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubAppClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(path: string): Promise<GitHubAppGetResult> {
    const jwt = await this.getJwt();
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
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
    return {
      ok: true,
      status: response.status,
      data: text ? JSON.parse(text) : null,
    };
  }

  private async getJwt(): Promise<string> {
    if (this.jwt) {
      return this.jwt;
    }
    this.jwt = await createGitHubAppJwt(this.options.appId, this.options.privateKeyPem);
    return this.jwt;
  }
}

export type BlockedInstallationRead = {
  method: "GET";
  path: string;
  reason: "requires_installation_access_token";
  mint_would_call: "POST /app/installations/{installation_id}/access_tokens";
};

export function installationScopedRepoReads(
  org: string,
  repo: string,
): BlockedInstallationRead[] {
  const base = `/repos/${org}/${repo}`;
  const paths = [base, `${base}/topics`, `${base}/branches/main/protection`];
  return paths.map((path) => ({
    method: "GET",
    path,
    reason: "requires_installation_access_token",
    mint_would_call: "POST /app/installations/{installation_id}/access_tokens",
  }));
}
