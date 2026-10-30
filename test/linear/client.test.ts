import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LinearClient,
  LINEAR_MUTATION_MAX_ATTEMPTS,
  MAX_RETRY_AFTER_MS,
  publicLinearErrorMessage,
} from "../../src/linear/client.js";
import { buildLinearApiKey } from "../project-factory/linear-mock.js";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function graphQlRateLimitedOnHttp200() {
  return jsonResponse(200, {
    errors: [{ message: "Rate limited", extensions: { code: "RATELIMITED" } }],
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LinearClient", () => {
  it("fixes mutation max attempts at one for mutant resistance", () => {
    expect(LINEAR_MUTATION_MAX_ATTEMPTS).toBe(1);
  });

  it("maps RATELIMITED on HTTP 400 to rate_limited and retries reads only", async () => {
    const apiKey = buildLinearApiKey();
    let attempts = 0;
    const client = new LinearClient({
      apiKey,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(400, {
          errors: [{ message: "Rate limit", extensions: { code: "RATELIMITED" } }],
        });
      },
    });

    const result = await client.request("query Read { viewer { id } }");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toBe(publicLinearErrorMessage(400, "rate_limited"));
      expect(result.error.message).not.toContain("Rate limit");
    }
    expect(attempts).toBe(3);
  });

  it("maps AUTHENTICATION_ERROR on HTTP 400 to missing_secret", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        jsonResponse(400, {
          errors: [
            {
              message: "Invalid credentials",
              extensions: { code: "AUTHENTICATION_ERROR" },
            },
          ],
        }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_secret" },
    });
    if (!result.ok) {
      expect(result.error.message).not.toContain("Invalid credentials");
    }
  });

  it("retries read queries on 5xx until max attempts", async () => {
    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(502, {
          errors: [{ message: "bad gateway", extensions: { code: "INTERNAL_ERROR" } }],
        });
      },
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result.ok).toBe(false);
    expect(attempts).toBe(3);
  });

  it("caps Retry-After delay for read retries", async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (typeof ms === "number") {
        delays.push(ms);
      }
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout);

    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(
          502,
          { errors: [{ message: "bad gateway" }] },
          { "Retry-After": "30" },
        );
      },
    });

    const promise = client.request("query Teams { teams { nodes { id } } }");
    await vi.runAllTimersAsync();
    await promise;

    expect(attempts).toBe(3);
    expect(delays.every((d) => d <= MAX_RETRY_AFTER_MS)).toBe(true);
    expect(delays[0]).toBe(MAX_RETRY_AFTER_MS);
  });

  it("does not pass raw GraphQL error message through on HTTP 200 errors", async () => {
    const rawMessage = "LINEAR_RAW_GRAPHQL_200_CLIENT_DO_NOT_LEAK_77102";
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        jsonResponse(200, {
          errors: [
            {
              message: rawMessage,
              extensions: { code: "INTERNAL_ERROR" },
            },
          ],
        }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        publicLinearErrorMessage(200, "upstream_error"),
      );
      expect(result.error.message).not.toContain(rawMessage);
    }
  });

  it("maps RATELIMITED inside HTTP 200 GraphQL errors and retries reads", async () => {
    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(200, {
          errors: [{ message: "Rate limited", extensions: { code: "RATELIMITED" } }],
        });
      },
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toBe(publicLinearErrorMessage(200, "rate_limited"));
    }
    expect(attempts).toBe(3);
  });

  it("forces retryable false on mutation GraphQL errors on HTTP 200", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => graphQlRateLimitedOnHttp200(),
    });

    const result = await client.request(
      "mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.message).toBe(publicLinearErrorMessage(200, "rate_limited"));
      expect(result.error.retryable).toBe(false);
    }
  });

  it("keeps query retryable on the same HTTP 200 GraphQL error as on main", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => graphQlRateLimitedOnHttp200(),
    });

    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.message).toBe(publicLinearErrorMessage(200, "rate_limited"));
      expect(result.error.retryable).toBe(true);
    }
  });

  it("does not retry mutations on 5xx", async () => {
    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(502, {
          errors: [{ message: "bad gateway" }],
        });
      },
    });

    const result = await client.request(
      "mutation ProjectCreate($input: ProjectCreateInput!) { projectCreate(input: $input) { success } }",
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
    if (!result.ok) {
      expect(result.error.retryable).toBe(false);
    }
  });

  it("sends mutations once on retryable HTTP errors while queries still retry", async () => {
    const retryable502 = () =>
      jsonResponse(502, {
        errors: [{ message: "bad gateway", extensions: { code: "INTERNAL_ERROR" } }],
      });

    let mutationAttempts = 0;
    const mutationClient = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        mutationAttempts += 1;
        return retryable502();
      },
    });
    const mutationResult = await mutationClient.request(
      "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success } }",
    );
    expect(mutationResult.ok).toBe(false);
    expect(mutationAttempts).toBe(1);

    let queryAttempts = 0;
    const queryClient = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        queryAttempts += 1;
        return retryable502();
      },
    });
    const queryResult = await queryClient.request(
      "query Teams { teams { nodes { id } } }",
    );
    expect(queryResult.ok).toBe(false);
    expect(queryAttempts).toBe(3);
  });

  it("does not retry mutations on RATELIMITED HTTP 400", async () => {
    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(400, {
          errors: [{ message: "Rate limit", extensions: { code: "RATELIMITED" } }],
        });
      },
    });

    const result = await client.request(
      "mutation LabelCreate($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success } }",
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("does not retry mutations on RATELIMITED inside HTTP 200 GraphQL errors", async () => {
    let attempts = 0;
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(200, {
          errors: [{ message: "Rate limited", extensions: { code: "RATELIMITED" } }],
        });
      },
    });

    const result = await client.request(
      "mutation RelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }",
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("maps HTTP 401 to missing_secret", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        jsonResponse(401, { errors: [{ message: "Unauthorized" }] }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_secret" },
    });
    if (!result.ok) {
      expect(result.error.message).not.toContain("Unauthorized");
    }
  });

  it("maps FORBIDDEN extension code to permission_denied", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        jsonResponse(400, {
          errors: [
            {
              message: "Not allowed to perform action",
              extensions: { code: "FORBIDDEN" },
            },
          ],
        }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    if (!result.ok) {
      expect(result.error.message).not.toContain("Not allowed");
    }
  });

  it("maps NOT_AUTHORIZED extension code to permission_denied", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        jsonResponse(400, {
          errors: [
            {
              message: "Actor not authorized",
              extensions: { code: "NOT_AUTHORIZED" },
            },
          ],
        }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
    if (!result.ok) {
      expect(result.error.message).not.toContain("Actor not authorized");
    }
  });

  it("maps HTTP 403 to permission_denied", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () => jsonResponse(403, { errors: [{ message: "Forbidden" }] }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });
  });

  it("never includes the API key in error messages", async () => {
    const apiKey = buildLinearApiKey();
    const client = new LinearClient({
      apiKey,
      fetchImpl: async () =>
        jsonResponse(500, { errors: [{ message: "server error" }] }),
    });
    const result = await client.request("query Teams { teams { nodes { id } } }");
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });
});
