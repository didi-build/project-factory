import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import type { ProjectFactoryEnv } from "../src/env.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "1",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "2",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_BEARER_TOKEN: "test-bearer-token-at-least-32-chars-long",
};

describe("worker fetch", () => {
  it("allows /health without auth", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
  });

  it("returns 401 on /mcp without bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", { method: "POST" }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 on other paths without bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/other"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 on /mcp with wrong bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });
});
