import { createGitHubAppJwt } from "./jwt.js";

export type GitHubClientOptions = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
};

export type GitHubError = {
  status: number;
  code?: string;
  message: string;
  retryable: boolean;
};

export class GitHubClient {
  private installationToken: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: GitHubError }> {
    const token = await this.getInstallationToken();
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (response.ok) {
        if (response.status === 204) {
          return { ok: true, data: null };
        }
        const text = await response.text();
        return { ok: true, data: text ? JSON.parse(text) : null };
      }
      const retryable = response.status >= 500 || response.status === 429;
      const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
      if (retryable && attempt < 2) {
        const delayMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : (attempt + 1) * 500;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      let apiMessage = response.statusText;
      try {
        const errBody = (await response.json()) as { message?: string };
        apiMessage = errBody.message ?? apiMessage;
      } catch {
        // ignore parse errors
      }
      return {
        ok: false,
        error: {
          status: response.status,
          message: apiMessage,
          retryable,
        },
      };
    }
    return {
      ok: false,
      error: { status: 500, message: "exhausted retries", retryable: true },
    };
  }

  private async getInstallationToken(): Promise<string> {
    if (this.installationToken) {
      return this.installationToken;
    }
    const jwt = await createGitHubAppJwt(
      this.options.appId,
      this.options.privateKeyPem,
    );
    const response = await this.fetchImpl(
      `https://api.github.com/app/installations/${this.options.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`installation token failed: ${response.status}`);
    }
    const data = (await response.json()) as { token: string };
    this.installationToken = data.token;
    return data.token;
  }
}
