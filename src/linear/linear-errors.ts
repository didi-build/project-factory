import type { LinearError } from "./client.js";

export function trimLinearErrorMessage(error: LinearError): string {
  const code = error.code ? String(error.code) : "unknown";
  return `${error.status} ${code}`;
}

export function mapLinearFailure(
  error: LinearError,
  step: string,
): { error: { code: string; message: string; step: string; retryable?: boolean } } {
  if (error.code === "missing_secret") {
    return {
      error: {
        code: "missing_secret",
        message: "PROJECT_FACTORY_LINEAR_API_KEY",
        step,
        retryable: false,
      },
    };
  }
  if (error.code === "rate_limited" || error.status === 429) {
    return {
      error: {
        code: "rate_limited",
        message: trimLinearErrorMessage(error),
        step,
        retryable: true,
      },
    };
  }
  if (error.code === "permission_denied" || error.status === 403) {
    return {
      error: {
        code: "permission_denied",
        message: trimLinearErrorMessage(error),
        step,
        retryable: false,
      },
    };
  }
  if (error.status === 401) {
    return {
      error: {
        code: "permission_denied",
        message: trimLinearErrorMessage(error),
        step,
        retryable: false,
      },
    };
  }
  return {
    error: {
      code: "upstream_error",
      message: trimLinearErrorMessage(error),
      step,
      retryable: error.retryable,
    },
  };
}
