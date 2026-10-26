import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { buildCreateProjectRepoDryRunPlan } from "../../src/tools/dry-run-plan.js";
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

describe("buildCreateProjectRepoDryRunPlan", () => {
  it("lists installation-scoped GETs that need a token mint on non-dry-run", async () => {
    const methods: string[] = [];
    const plan = await buildCreateProjectRepoDryRunPlan(
      { ...envBase, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
      {
        name: "demo-app",
        org: "didi-build",
        templateRepo: "didi-build/launchpad",
        isPrivate: false,
      },
      {
        fetchImpl: async (input, init) => {
          methods.push((init?.method ?? "GET").toUpperCase());
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("/app/installations/")) {
            return new Response(
              JSON.stringify({ id: 1, account: { login: "didi-build" } }),
              {
                status: 200,
              },
            );
          }
          if (url.includes("cloudflare.com") && url.endsWith("/accounts")) {
            return new Response(
              JSON.stringify({
                success: true,
                result: [{ id: "cf-1", name: "Didi Build" }],
              }),
              { status: 200 },
            );
          }
          if (url.includes("/workers/scripts/demo-app")) {
            return new Response(
              JSON.stringify({ success: false, errors: [{ message: "not found" }] }),
              { status: 404 },
            );
          }
          return new Response(JSON.stringify({ success: true, result: [] }), {
            status: 200,
          });
        },
      },
    );
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(plan.github.reads_requiring_installation_token.length).toBeGreaterThan(0);
    expect(plan.github.repo_exists).toBeNull();
  });
});
