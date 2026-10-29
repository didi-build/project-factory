import { describe, expect, it } from "vitest";
import { authorizeBearer, factoryCaller } from "../../src/auth/bearer.js";
import type { ProjectFactoryEnv } from "../../src/env.js";

const baseEnv: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "1",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "2",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_BEARER_TOKEN: "correct-bearer-token-value-32chars",
};

describe("authorizeBearer", () => {
  it("returns 401 path when token is wrong", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(await authorizeBearer(request, baseEnv)).toBe(false);
  });

  it("accepts the configured bearer token", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer correct-bearer-token-value-32chars" },
    });
    expect(await authorizeBearer(request, baseEnv)).toBe(true);
  });

  it("rejects when bearer secret is missing", async () => {
    const request = new Request("https://example.com/mcp", {
      headers: { Authorization: "Bearer anything" },
    });
    const env = { ...baseEnv, PROJECT_FACTORY_BEARER_TOKEN: undefined };
    expect(await authorizeBearer(request, env)).toBe(false);
  });
});

describe("factoryCaller", () => {
  it("caps X-Factory-Caller length and rejects invalid charset before audit use", () => {
    const long = `a${"b".repeat(80)}`;
    const request = new Request("https://example.com/mcp", {
      headers: { "X-Factory-Caller": long },
    });
    expect(factoryCaller(request)).toHaveLength(64);
    expect(factoryCaller(request)).toMatch(/^[a-zA-Z0-9._-]+$/);

    const bad = new Request("https://example.com/mcp", {
      headers: { "X-Factory-Caller": "bot@evil" },
    });
    expect(factoryCaller(bad)).toBe("unknown");
  });
});
