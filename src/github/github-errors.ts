import type { GitHubError } from "./client.js";

export const MISSING_GITHUB_APP_SECRET_MESSAGE =
  "PROJECT_FACTORY_GH_APP_ID or PROJECT_FACTORY_GH_PRIVATE_KEY";

export function trimGithubErrorMessage(error: GitHubError): string {
  const code = error.code ? String(error.code) : "unknown";
  return `${error.status} ${code}`;
}

export function trimmedHttpDetail(status: number, code: string): string {
  return `${status} ${code}`;
}

const GITHUB_API_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function sanitizeGithubApiCode(raw: string | undefined): string {
  if (!raw) {
    return "unknown";
  }
  const normalized = raw.trim().toLowerCase();
  if (!GITHUB_API_CODE_PATTERN.test(normalized)) {
    return "unknown";
  }
  return normalized;
}

export async function githubResponseFailure(response: Response): Promise<GitHubError> {
  let apiCode: string | undefined;
  try {
    const errBody = (await response.json()) as {
      message?: string;
      code?: string;
      errors?: { code?: string }[];
    };
    apiCode = sanitizeGithubApiCode(errBody.code ?? errBody.errors?.[0]?.code);
  } catch {
    // ignore parse errors
  }
  const rateRemaining = response.headers.get("x-ratelimit-remaining");
  const isSecondaryRateLimit = response.status === 403 && rateRemaining === "0";
  if (isSecondaryRateLimit) {
    return {
      status: response.status,
      code: "rate_limited",
      message: trimmedHttpDetail(response.status, "rate_limited"),
      retryable: true,
    };
  }
  if (response.status === 401) {
    return {
      status: 401,
      code: "missing_secret",
      message: trimmedHttpDetail(401, "missing_secret"),
      retryable: false,
    };
  }
  if (response.status === 403 || response.status === 404) {
    return {
      status: response.status,
      code: "permission_denied",
      message: trimmedHttpDetail(response.status, "permission_denied"),
      retryable: false,
    };
  }
  const factoryCode = apiCode ?? "unknown";
  const retryable = response.status >= 500 || response.status === 429;
  return {
    status: response.status,
    code: response.status === 429 ? "rate_limited" : factoryCode,
    message: trimmedHttpDetail(
      response.status,
      response.status === 429 ? "rate_limited" : factoryCode,
    ),
    retryable,
  };
}

export function mapMintDryRunFailure(error: GitHubError): {
  code: string;
  message: string;
  retryable?: boolean;
} {
  if (error.code === "missing_secret" || error.status === 401) {
    return {
      code: "missing_secret",
      message: MISSING_GITHUB_APP_SECRET_MESSAGE,
      retryable: false,
    };
  }
  if (error.code === "rate_limited") {
    return {
      code: "rate_limited",
      message: error.message,
      retryable: true,
    };
  }
  if (
    error.code === "permission_denied" ||
    error.status === 403 ||
    error.status === 404
  ) {
    return {
      code: "permission_denied",
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: "upstream_error",
    message: error.message,
    retryable: error.retryable,
  };
}

export function mapGithubFailure(
  error: GitHubError,
  step: string,
): { error: { code: string; message: string; step: string; retryable?: boolean } } {
  const message = trimGithubErrorMessage(error);
  if (error.code === "missing_secret") {
    return {
      error: {
        code: "missing_secret",
        message: MISSING_GITHUB_APP_SECRET_MESSAGE,
        step,
        retryable: false,
      },
    };
  }
  if (error.code === "rate_limited") {
    return { error: { code: "rate_limited", message, step, retryable: true } };
  }
  if (error.code === "permission_denied" || error.status === 403) {
    return { error: { code: "permission_denied", message, step, retryable: false } };
  }
  if (error.status === 429) {
    return { error: { code: "rate_limited", message, step, retryable: true } };
  }
  return {
    error: { code: "upstream_error", message, step, retryable: error.retryable },
  };
}
