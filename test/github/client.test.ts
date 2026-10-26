import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubClient } from "../../src/github/client.js";
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
});
