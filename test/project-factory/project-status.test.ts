import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { projectStatus } from "../../src/tools/project-status.js";
import { MISSING_GITHUB_APP_SECRET_MESSAGE } from "../../src/github/github-errors.js";
import { EXPECTED_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS } from "./expected-github-payloads.js";
import { fakePkcs8Pem } from "./github-mock.js";

const envBase: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
};

let privateKeyPem: string;

beforeAll(async () => {
  privateKeyPem = await fakePkcs8Pem();
});

describe("projectStatus", () => {
  it("mints read-only dry-run installation token permissions for GETs", async () => {
    const methods: string[] = [];
    let mintBody: unknown;
    await projectStatus(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      "req-ps-1",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async (input, init) => {
          const method = (init?.method ?? "GET").toUpperCase();
          methods.push(method);
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("access_tokens")) {
            mintBody = init?.body ? JSON.parse(String(init.body)) : undefined;
            return new Response(JSON.stringify({ token: "dry-run-token" }), {
              status: 201,
            });
          }
          if (url.endsWith("/repos/didi-build/demo-app")) {
            return new Response(JSON.stringify({ full_name: "didi-build/demo-app" }), {
              status: 200,
            });
          }
          if (url.endsWith("/topics")) {
            return new Response(JSON.stringify({ names: ["project-factory"] }), {
              status: 200,
            });
          }
          if (url.includes("/protection")) {
            return new Response("{}", { status: 404 });
          }
          return new Response("{}", { status: 404 });
        },
      },
    );
    expect(mintBody).toEqual({
      permissions: EXPECTED_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
    });
    expect(methods.filter((m) => m !== "GET")).toEqual(["POST"]);
  });

  it("does not treat a non-404 repo GET failure as missing", async () => {
    const result = await projectStatus(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      "req-ps-502",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async (input) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("access_tokens")) {
            return new Response(JSON.stringify({ token: "dry-run-token" }), {
              status: 201,
            });
          }
          if (url.endsWith("/repos/didi-build/demo-app")) {
            return new Response(JSON.stringify({ message: "bad gateway" }), {
              status: 502,
            });
          }
          return new Response("{}", { status: 404 });
        },
      },
    );
    expect(result).toMatchObject({
      status: "done",
      github: { exists: null },
    });
    if ("warnings" in result) {
      expect(result.warnings.join(" ")).not.toContain("bad gateway");
      expect(result.warnings.some((w) => w.includes("502"))).toBe(true);
    }
  });

  it("leaves factory ownership unknown when topics read fails", async () => {
    const result = await projectStatus(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      "req-ps-topics",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async (input) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("access_tokens")) {
            return new Response(JSON.stringify({ token: "dry-run-token" }), {
              status: 201,
            });
          }
          if (url.endsWith("/repos/didi-build/demo-app")) {
            return new Response(JSON.stringify({ full_name: "didi-build/demo-app" }), {
              status: 200,
            });
          }
          if (url.endsWith("/topics")) {
            return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
          }
          return new Response("{}", { status: 404 });
        },
      },
    );
    expect(result).toMatchObject({
      github: { exists: true, factory_owned: null },
    });
    if ("warnings" in result) {
      expect(result.warnings.some((w) => w.includes("GET topics failed"))).toBe(true);
      expect(result.warnings.join(" ")).not.toContain("nope");
    }
  });

  it("leaves protection_ok unknown when branch protection read fails with non-404", async () => {
    const result = await projectStatus(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      "req-ps-protection",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async (input) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("access_tokens")) {
            return new Response(JSON.stringify({ token: "dry-run-token" }), {
              status: 201,
            });
          }
          if (url.endsWith("/repos/didi-build/demo-app")) {
            return new Response(JSON.stringify({ full_name: "didi-build/demo-app" }), {
              status: 200,
            });
          }
          if (url.endsWith("/topics")) {
            return new Response(JSON.stringify({ names: ["project-factory"] }), {
              status: 200,
            });
          }
          if (url.includes("/protection")) {
            return new Response(
              JSON.stringify({ message: "upstream protection error" }),
              {
                status: 502,
              },
            );
          }
          return new Response("{}", { status: 404 });
        },
      },
    );
    expect(result).toMatchObject({
      github: { exists: true, protection_ok: null },
    });
    if ("warnings" in result) {
      expect(
        result.warnings.some((w) => w.includes("GET branch protection failed")),
      ).toBe(true);
      expect(result.warnings.join(" ")).not.toContain("upstream protection error");
    }
  });

  it.each([
    ["403", 403, "permission_denied", false],
    ["404", 404, "permission_denied", false],
    ["401", 401, "missing_secret", false],
  ] as const)(
    "maps mint %s to %s (retryable=%s)",
    async (_label, status, code, retryable) => {
      const result = await projectStatus(
        { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        `req-mint-${status}`,
        "test",
        { name: "demo-app" },
        {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.includes("access_tokens")) {
              return new Response(JSON.stringify({ message: "upstream detail" }), {
                status,
              });
            }
            return new Response("{}", { status: 404 });
          },
        },
      );
      expect(result).toMatchObject({
        error: { code, retryable },
      });
      if (code === "missing_secret" && "error" in result) {
        expect(result.error.message).toContain("PROJECT_FACTORY_GH_APP_ID");
        expect(result.error.message).toContain("PROJECT_FACTORY_GH_PRIVATE_KEY");
      }
      if ("error" in result) {
        expect(result.error.message).not.toContain("upstream detail");
      }
    },
  );

  it("maps secondary rate-limit mint 403 to rate_limited", async () => {
    const result = await projectStatus(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      "req-mint-secondary",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes("access_tokens")) {
            return new Response(JSON.stringify({ message: "secondary" }), {
              status: 403,
              headers: { "x-ratelimit-remaining": "0" },
            });
          }
          return new Response("{}", { status: 404 });
        },
      },
    );
    expect(result).toMatchObject({
      error: { code: "rate_limited", retryable: true },
    });
  });

  it("returns missing_secret when private key is malformed", async () => {
    const result = await projectStatus(
      {
        ...envBase,
        PROJECT_FACTORY_GH_PRIVATE_KEY: "not-valid-pem",
      },
      "req-bad-pem",
      "test",
      { name: "demo-app" },
      {
        fetchImpl: async () => {
          throw new Error("GitHub fetch must not run");
        },
      },
    );
    expect(result).toMatchObject({
      error: { code: "missing_secret", message: MISSING_GITHUB_APP_SECRET_MESSAGE },
    });
  });
});
