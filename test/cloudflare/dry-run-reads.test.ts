import { describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { cloudflareDryRunReads } from "../../src/cloudflare/dry-run-reads.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "1",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "2",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: "fake-token-for-tests-only",
};

describe("cloudflareDryRunReads", () => {
  it("detects an existing worker via settings GET and lists secret names", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "fixture-account-a", name: "Fixture Org" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/settings")) {
        return new Response(
          JSON.stringify({ success: true, result: { bindings: [] } }),
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
    expect(result).not.toHaveProperty("account_id");
  });

  it("reports parse failures without throwing", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "fixture-account-a", name: "Fixture Org" }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/workers/scripts/demo-app/settings")) {
        return new Response("export default {}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    expect(result.error).toContain("invalid_json");
  });

  it("does not surface raw Cloudflare errors message text", async () => {
    const upstreamMessage = "cf-upstream-detail-do-not-leak";
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: upstreamMessage }],
          }),
          { status: 403 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    expect(result.error).toBe("accounts 403 cloudflare_error");
    expect(result.error).not.toContain(upstreamMessage);
  });

  it("reports account count mismatch without echoing account ids", async () => {
    const result = await cloudflareDryRunReads(env, "demo-app", async (input) => {
      const url = String(input);
      if (url.endsWith("/accounts")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              { id: "fixture-account-one", name: "A" },
              { id: "fixture-account-two", name: "B" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    expect(result.error).toBe("400 account_count");
    expect(result.error).not.toContain("fixture-account-one");
    expect(result.error).not.toContain("fixture-account-two");
  });
});
