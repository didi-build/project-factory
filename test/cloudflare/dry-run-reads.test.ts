import { describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { cloudflareDryRunReads } from "../../src/cloudflare/dry-run-reads.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "1",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "2",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: "fake-token",
};

describe("cloudflareDryRunReads", () => {
  it("detects an existing worker via settings GET and lists secret names", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "acct-1", name: "Didi Build" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { bindings: [], tags: ["project-factory"] },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/secrets")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ name: "API_KEY" }],
          }),
          { status: 200 },
        );
      }
      return new Response("not json", { status: 500 });
    });
    expect(result.worker_exists).toBe(true);
    expect(result.worker_secret_names).toEqual(["API_KEY"]);
    expect(result.account_id).toBe("acct-1");
    expect(result.conflict_not_factory_owned).toBeUndefined();
  });

  it("flags foreign workers without project-factory tag", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "acct-1", name: "Didi Build" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/settings")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { tags: ["other-owner"] },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/secrets")) {
        return new Response(JSON.stringify({ success: true, result: [] }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });
    expect(result.worker_exists).toBe(true);
    expect(result.conflict_not_factory_owned).toBe(true);
  });

  it("reports parse failures without throwing", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "acct-1", name: "Didi Build" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/settings")) {
        return new Response("export default {}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    expect(result.error).toContain("not valid JSON");
  });
});
