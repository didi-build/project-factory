import { describe, expect, it } from "vitest";
import { LinearClient } from "../../src/linear/client.js";
import { buildLinearApiKey } from "../project-factory/linear-mock.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("LinearClient", () => {
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
    }
    expect(attempts).toBe(3);
  });

  it("does not retry mutations on 5xx", async () => {
    const apiKey = buildLinearApiKey();
    let attempts = 0;
    const client = new LinearClient({
      apiKey,
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
