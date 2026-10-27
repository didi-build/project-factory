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

const MAX_RETRY_AFTER_MS = 10_000;

function normalizeApiCode(
  status: number,
  apiCode: string | undefined,
  apiMessage: string,
): { code: string; retryable: boolean } {
  const upper = apiCode?.toUpperCase();
  if (upper === "RATELIMITED" || status === 429) {
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
  const lower = apiMessage.toLowerCase();
  if (
    lower.includes("authentication") ||
    lower.includes("not authenticated") ||
    lower.includes("invalid api key")
  ) {
    return { code: "missing_secret", retryable: false };
  }
  if (lower.includes("not authorized") || lower.includes("forbidden")) {
    return { code: "permission_denied", retryable: false };
  }
  return { code: "upstream_error", retryable: false };
}

function normalizeGraphqlError(
  status: number,
  message: string,
  code?: string,
): LinearError {
  const normalized = normalizeApiCode(status, code, message);
  return {
    status,
    code: normalized.code,
    message,
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
          message: "PROJECT_FACTORY_LINEAR_API_KEY",
          retryable: false,
        },
      };
    }

    const mutation = isLinearMutation(query);
    const maxAttempts = mutation ? 1 : 3;

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
        let apiMessage = response.statusText;
        try {
          const errBody = (await response.json()) as {
            errors?: { message?: string; extensions?: { code?: string } }[];
          };
          apiMessage = errBody.errors?.[0]?.message ?? apiMessage;
          apiCode = errBody.errors?.[0]?.extensions?.code;
        } catch {
          // ignore parse errors
        }
        const normalized = normalizeApiCode(response.status, apiCode, apiMessage);
        if (!mutation && normalized.retryable && attempt < maxAttempts - 1) {
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
            status: response.status,
            code: normalized.code,
            message: apiMessage,
            retryable: mutation ? false : normalized.retryable,
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
            message: "response was not valid JSON",
            retryable: false,
          },
        };
      }

      if (body.errors?.length) {
        const first = body.errors[0];
        const message = first.message ?? "GraphQL error";
        const code = first.extensions?.code;
        const err = normalizeGraphqlError(response.status, message, code);
        if (!mutation && err.retryable && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
          continue;
        }
        return { ok: false, error: err };
      }

      if (!body.data) {
        return {
          ok: false,
          error: {
            status: response.status,
            code: "upstream_error",
            message: "empty GraphQL data",
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
        message: "max retries exceeded",
        retryable: true,
      },
    };
  }
}
