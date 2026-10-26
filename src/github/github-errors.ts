import type { GitHubError } from "./client.js";

export function trimGithubErrorMessage(error: GitHubError): string {
  const code = error.code ? String(error.code) : "unknown";
  return `${error.status} ${code}`;
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
        message: "PROJECT_FACTORY_GH_APP_ID or PROJECT_FACTORY_GH_PRIVATE_KEY",
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
