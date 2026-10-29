import type { GitHubError } from "./client.js";
import { githubResponseFailure, trimmedHttpDetail } from "./github-errors.js";
import { createGitHubAppJwt } from "./jwt.js";

export type GitHubAppClientOptions = {
  appId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
};

export type GitHubAppGetResult =
  | { ok: true; data: unknown; status: number }
  | ({ ok: false; status: number } & GitHubError);

export class GitHubAppClient {
  private jwt: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubAppClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(path: string): Promise<GitHubAppGetResult> {
    let jwt: string;
    try {
      jwt = await this.getJwt();
    } catch {
      return {
        ok: false,
        status: 401,
        code: "missing_secret",
        message: trimmedHttpDetail(401, "missing_secret"),
        retryable: false,
      };
    }
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
      const failure = await githubResponseFailure(response);
      return { ok: false, ...failure };
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
