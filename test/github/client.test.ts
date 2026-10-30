import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../../src/github/client.js";
import {
  mapGithubFailure,
  MISSING_GITHUB_APP_SECRET_MESSAGE,
} from "../../src/github/github-errors.js";
import { EXPECTED_WRITE_INSTALLATION_TOKEN_PERMISSIONS } from "../project-factory/expected-github-payloads.js";
import { normalizePrivateKeyPem } from "../../src/github/pem.js";
import { fakePkcs8Pem } from "../project-factory/github-mock.js";

describe("GitHubClient installation token mint", () => {
  it("requests scoped write permissions on the write path", async () => {
    let mintBody: unknown;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = normalizePrivateKeyPem(
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    );
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url, init) => {
        const path = String(url);
        if (path.includes("access_tokens")) {
          mintBody = init?.body ? JSON.parse(String(init.body)) : undefined;
          return new Response(JSON.stringify({ token: "t" }), { status: 201 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    await client.request("GET", "/repos/o/r");
    expect(mintBody).toEqual({
      permissions: EXPECTED_WRITE_INSTALLATION_TOKEN_PERMISSIONS,
    });
    expect(mintBody).not.toHaveProperty("repositories");
  });

  it("maps token mint 401 to missing_secret without throwing", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url) => {
        if (String(url).includes("access_tokens")) {
          return new Response(JSON.stringify({ message: "bad credentials" }), {
            status: 401,
          });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_secret");
      expect(result.error.message).toContain("PROJECT_FACTORY_GH_APP_ID");
      expect(result.error.message).toContain("PROJECT_FACTORY_GH_PRIVATE_KEY");
      expect(result.error.message).toBe(MISSING_GITHUB_APP_SECRET_MESSAGE);
      const mapped = mapGithubFailure(result.error, "read_repo");
      expect(mapped.error.message).toBe(MISSING_GITHUB_APP_SECRET_MESSAGE);
    }
  });

  it("maps malformed private key to missing_secret without throwing", async () => {
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: "not-valid-pem",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_secret");
      expect(result.error.message).toBe(MISSING_GITHUB_APP_SECRET_MESSAGE);
    }
  });

  it("maps token mint 404 to permission_denied without throwing", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url) => {
        if (String(url).includes("access_tokens")) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
          });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("maps token mint 5xx to retryable upstream_error without throwing", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url) => {
        if (String(url).includes("access_tokens")) {
          return new Response(JSON.stringify({ message: "error" }), { status: 500 });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("upstream_error");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("maps token mint 422 to non-retryable upstream_error without throwing", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url) => {
        if (String(url).includes("access_tokens")) {
          return new Response(JSON.stringify({ message: "Validation Failed" }), {
            status: 422,
          });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("upstream_error");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("maps token mint 403 to permission_denied without throwing", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url) => {
        if (String(url).includes("access_tokens")) {
          return new Response(JSON.stringify({ message: "Forbidden" }), {
            status: 403,
          });
        }
        return new Response("{}", { status: 200 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("caps Retry-After delay for read retries at 10s", async () => {
    const pem = await fakePkcs8Pem();
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (typeof ms === "number") {
        delays.push(ms);
      }
      return realSetTimeout(handler, 0, ...args);
    }) as typeof setTimeout);

    let repoAttempts = 0;
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url, init) => {
        const path = String(url);
        if (path.includes("access_tokens")) {
          return new Response(JSON.stringify({ token: "t" }), { status: 201 });
        }
        if ((init?.method ?? "GET") === "GET" && path.includes("/repos/o/r")) {
          repoAttempts += 1;
          return new Response(JSON.stringify({ message: "bad gateway" }), {
            status: 502,
            headers: { "Retry-After": "30" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    });

    const result = await client.request("GET", "/repos/o/r");

    setTimeoutSpy.mockRestore();
    expect(result.ok).toBe(false);
    expect(repoAttempts).toBe(3);
    expect(delays.length).toBeGreaterThan(0);
    expect(delays.every((d) => d <= 10_000)).toBe(true);
    expect(delays[0]).toBe(10_000);
  });

  it("maps secondary rate-limit 403 on API reads to rate_limited", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url, init) => {
        const path = String(url);
        if (path.includes("access_tokens")) {
          return new Response(JSON.stringify({ token: "t" }), { status: 201 });
        }
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({ message: "secondary limit" }), {
            status: 403,
            headers: { "x-ratelimit-remaining": "0" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toBe("403 rate_limited");
    }
  });

  it("uses unknown when the API error body is not JSON", async () => {
    const pem = await fakePkcs8Pem();
    const client = new GitHubClient({
      appId: "1",
      installationId: "2",
      privateKeyPem: pem,
      fetchImpl: async (url, init) => {
        const path = String(url);
        if (path.includes("access_tokens")) {
          return new Response(JSON.stringify({ token: "t" }), { status: 201 });
        }
        if ((init?.method ?? "GET") === "GET" && path.includes("/repos/o/r")) {
          return new Response("not json", { status: 422 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    const result = await client.request("GET", "/repos/o/r");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown");
      expect(result.error.message).toBe("422 unknown");
    }
  });

  it.each([
    [422, "upstream-secret-code"],
    [502, "upstream-secret-code"],
  ] as const)(
    "sanitizes disallowed upstream body code on request %s to unknown",
    async (status, upstreamCode) => {
      const pem = await fakePkcs8Pem();
      const client = new GitHubClient({
        appId: "1",
        installationId: "2",
        privateKeyPem: pem,
        fetchImpl: async (url, init) => {
          const path = String(url);
          if (path.includes("access_tokens")) {
            return new Response(JSON.stringify({ token: "t" }), { status: 201 });
          }
          if ((init?.method ?? "GET") === "GET" && path.includes("/repos/o/r")) {
            return new Response(
              JSON.stringify({ message: "secret detail", code: upstreamCode }),
              {
                status,
              },
            );
          }
          return new Response("{}", { status: 404 });
        },
      });
      const result = await client.request("GET", "/repos/o/r");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown");
        expect(result.error.message).toBe(`${status} unknown`);
        expect(result.error.message).not.toContain("upstream");
      }
    },
  );
});
