import { createGitHubAppJwt } from "./jwt.js";
import { trimGithubErrorMessage } from "./github-errors.js";

export const WRITE_INSTALLATION_TOKEN_PERMISSIONS = {
  administration: "write",
  contents: "read",
  issues: "write",
  metadata: "read",
} as const;

export type InstallationTokenPermissions = Record<string, string>;

export type GitHubClientOptions = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
  installationTokenPermissions?: InstallationTokenPermissions;
};

export type GitHubError = {
  status: number;
  code?: string;
  message: string;
  retryable: boolean;
};

const MAX_RETRY_AFTER_MS = 10_000;

export class GitHubClient {
  private installationToken: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly installationTokenPermissions: InstallationTokenPermissions;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.installationTokenPermissions =
      options.installationTokenPermissions ?? WRITE_INSTALLATION_TOKEN_PERMISSIONS;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: GitHubError }> {
    const tokenResult = await this.mintWriteInstallationToken();
    if (!tokenResult.ok) {
      return { ok: false, error: tokenResult.error };
    }
    const token = tokenResult.token;
    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const isGenerate = method === "POST" && path.includes("/generate");
    const maxAttempts = isGenerate ? 1 : 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      const rateReset = Number.parseInt(
        response.headers.get("x-ratelimit-reset") ?? "",
        10,
      );
      if (retryable && attempt < maxAttempts - 1 && !isGenerate) {
        let delayMs = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
          : (attempt + 1) * 500;
        if (response.status === 429 && Number.isFinite(rateReset)) {
          const resetDelay = rateReset * 1000 - Date.now() + 250;
          if (resetDelay > 0) {
            delayMs = Math.min(Math.max(delayMs, resetDelay), MAX_RETRY_AFTER_MS);
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      let apiMessage = response.statusText;
      let apiCode: string | undefined;
      try {
        const errBody = (await response.json()) as {
          message?: string;
          code?: string;
          errors?: { code?: string }[];
        };
        apiMessage = errBody.message ?? apiMessage;
        apiCode = errBody.code ?? errBody.errors?.[0]?.code;
      } catch {
        // ignore parse errors
      }
      const rateRemaining = response.headers.get("x-ratelimit-remaining");
      const isSecondaryRateLimit = response.status === 403 && rateRemaining === "0";
      return {
        ok: false,
        error: {
          status: response.status,
          code: isSecondaryRateLimit ? "rate_limited" : apiCode,
          message: apiMessage,
          retryable: isSecondaryRateLimit ? true : retryable,
        },
      };
    }
    return {
      ok: false,
      error: {
        status: 500,
        code: "unknown",
        message: "exhausted retries",
        retryable: true,
      },
    };
  }

  private async mintWriteInstallationToken(): Promise<
    { ok: true; token: string } | { ok: false; error: GitHubError }
  > {
    if (this.installationToken) {
      return { ok: true, token: this.installationToken };
    }
    let jwt: string;
    try {
      jwt = await createGitHubAppJwt(this.options.appId, this.options.privateKeyPem);
    } catch {
      return {
        ok: false,
        error: {
          status: 401,
          code: "missing_secret",
          message: "invalid GitHub app private key",
          retryable: false,
        },
      };
    }
    const response = await this.fetchImpl(
      `https://api.github.com/app/installations/${this.options.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permissions: this.installationTokenPermissions,
        }),
      },
    );
    if (!response.ok) {
      let apiMessage = response.statusText;
      let apiCode: string | undefined;
      try {
        const errBody = (await response.json()) as { message?: string; code?: string };
        apiMessage = errBody.message ?? apiMessage;
        apiCode = errBody.code;
      } catch {
        // ignore
      }
      const trimmed = trimGithubErrorMessage({
        status: response.status,
        code: apiCode,
        message: apiMessage,
        retryable: false,
      });
      if (response.status === 401) {
        return {
          ok: false,
          error: {
            status: 401,
            code: "missing_secret",
            message: trimmed,
            retryable: false,
          },
        };
      }
      if (response.status === 403 || response.status === 404) {
        return {
          ok: false,
          error: {
            status: response.status,
            code: "permission_denied",
            message: trimmed,
            retryable: false,
          },
        };
      }
      return {
        ok: false,
        error: {
          status: response.status,
          code: "upstream_error",
          message: trimmed,
          retryable: response.status >= 500,
        },
      };
    }
    const data = (await response.json()) as { token: string };
    this.installationToken = data.token;
    return { ok: true, token: data.token };
  }
}
