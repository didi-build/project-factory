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

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.fetchImpl("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.options.apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      const retryable = response.status >= 500 || response.status === 429;
      if (!response.ok) {
        if (retryable && attempt < maxAttempts - 1) {
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
        return {
          ok: false,
          error: {
            status: response.status,
            code:
              response.status === 401 || response.status === 403
                ? "permission_denied"
                : response.status === 429
                  ? "rate_limited"
                  : apiCode,
            message: apiMessage,
            retryable,
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
            message: "response was not valid JSON",
            retryable: false,
          },
        };
      }

      if (body.errors?.length) {
        const first = body.errors[0];
        const message = first.message ?? "GraphQL error";
        const code = first.extensions?.code;
        const isAuth =
          message.toLowerCase().includes("authentication") ||
          message.toLowerCase().includes("not authorized");
        return {
          ok: false,
          error: {
            status: response.status,
            code: isAuth ? "permission_denied" : code,
            message,
            retryable: false,
          },
        };
      }

      if (!body.data) {
        return {
          ok: false,
          error: {
            status: response.status,
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
        message: "max retries exceeded",
        retryable: true,
      },
    };
  }
}
