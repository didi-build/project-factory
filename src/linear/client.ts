import { isLinearMutation } from "./graphql-kind.js";

export type LinearClientOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export type LinearError = {
  status: number;
  code?: string;
  message: string;
  retryable: boolean;
};

export type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
};

export const MAX_RETRY_AFTER_MS = 10_000;

/** Idempotent reads may retry; mutations must not (duplicate side effects). */
export const LINEAR_QUERY_MAX_ATTEMPTS = 3;
export const LINEAR_MUTATION_MAX_ATTEMPTS = 1;

export function publicLinearErrorMessage(status: number, code: string): string {
  return `${status} ${code}`;
}

function normalizeApiCode(
  status: number,
  apiCode: string | undefined,
): { code: string; retryable: boolean } {
  const upper = apiCode?.toUpperCase();
  switch (upper) {
    case "RATELIMITED":
      return { code: "rate_limited", retryable: true };
    case "AUTHENTICATION_ERROR":
    case "INVALID_API_KEY":
      return { code: "missing_secret", retryable: false };
    case "FORBIDDEN":
    case "NOT_AUTHORIZED":
    case "NOT_ALLOWED":
      return { code: "permission_denied", retryable: false };
    default:
      break;
  }
  if (status === 429) {
    return { code: "rate_limited", retryable: true };
  }
  if (status === 401) {
    return { code: "missing_secret", retryable: false };
  }
  if (status === 403) {
    return { code: "permission_denied", retryable: false };
  }
  if (status >= 500) {
    return { code: "upstream_error", retryable: true };
  }
  return { code: "upstream_error", retryable: false };
}

function toLinearError(status: number, apiCode: string | undefined): LinearError {
  const normalized = normalizeApiCode(status, apiCode);
  return {
    status,
    code: normalized.code,
    message: publicLinearErrorMessage(status, normalized.code),
    retryable: normalized.retryable,
  };
}

export class LinearClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LinearClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ ok: true; data: T } | { ok: false; error: LinearError }> {
    if (!this.options.apiKey) {
      return {
        ok: false,
        error: {
          status: 0,
          code: "missing_secret",
          message: publicLinearErrorMessage(0, "missing_secret"),
          retryable: false,
        },
      };
    }

    const mutation = isLinearMutation(query);
    const maxAttempts = mutation
      ? LINEAR_MUTATION_MAX_ATTEMPTS
      : LINEAR_QUERY_MAX_ATTEMPTS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.fetchImpl("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.options.apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        let apiCode: string | undefined;
        try {
          const errBody = (await response.json()) as {
            errors?: { message?: string; extensions?: { code?: string } }[];
          };
          apiCode = errBody.errors?.[0]?.extensions?.code;
        } catch {
          // ignore parse errors
        }
        const err = toLinearError(response.status, apiCode);
        if (!mutation && err.retryable && attempt < maxAttempts - 1) {
          const retryAfter = Number.parseInt(
            response.headers.get("Retry-After") ?? "",
            10,
          );
          const delayMs = Number.isFinite(retryAfter)
            ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
            : (attempt + 1) * 500;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        return {
          ok: false,
          error: {
            ...err,
            retryable: mutation ? false : err.retryable,
          },
        };
      }

      let body: GraphQLResponse<T>;
      try {
        body = (await response.json()) as GraphQLResponse<T>;
      } catch {
        return {
          ok: false,
          error: {
            status: response.status,
            code: "upstream_error",
            message: publicLinearErrorMessage(response.status, "upstream_error"),
            retryable: false,
          },
        };
      }

      if (body.errors?.length) {
        const first = body.errors[0];
        const code = first.extensions?.code;
        const err = toLinearError(response.status, code);
        if (!mutation && err.retryable && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
          continue;
        }
        return {
          ok: false,
          error: {
            ...err,
            retryable: mutation ? false : err.retryable,
          },
        };
      }

      if (!body.data) {
        return {
          ok: false,
          error: {
            status: response.status,
            code: "upstream_error",
            message: publicLinearErrorMessage(response.status, "upstream_error"),
            retryable: false,
          },
        };
      }

      return { ok: true, data: body.data };
    }

    return {
      ok: false,
      error: {
        status: 500,
        code: "upstream_error",
        message: publicLinearErrorMessage(500, "upstream_error"),
        retryable: true,
      },
    };
  }
}
