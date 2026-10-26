import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS } from "../../src/github/dry-run-installation.js";
import { buildCreateProjectRepoDryRunPlan } from "../../src/tools/dry-run-plan.js";
import { fakePkcs8Pem } from "./github-mock.js";

const envBase: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
};

const INSTALLATION_TOKEN = "fake-dry-run-installation-token-do-not-leak";

let privateKeyPem: string;

beforeAll(async () => {
  privateKeyPem = await fakePkcs8Pem();
});

describe("buildCreateProjectRepoDryRunPlan", () => {
  it("mints a scoped installation token and reads repo state with GET", async () => {
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
          const method = (init?.method ?? "GET").toUpperCase();
          methods.push(method);
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          if (url.includes("access_tokens")) {
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            expect(body).toEqual({
              permissions: DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
            });
            expect(body).not.toHaveProperty("repositories");
            return new Response(JSON.stringify({ token: INSTALLATION_TOKEN }), {
              status: 201,
            });
          }
          if (url.includes("/app/installations/")) {
            return new Response(
              JSON.stringify({ id: 1, account: { login: "didi-build" } }),
              {
                status: 200,
              },
            );
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
              JSON.stringify({
                required_status_checks: {
                  strict: false,
                  checks: [{ context: "check" }],
                },
                required_pull_request_reviews: { required_approving_review_count: 0 },
                allow_force_pushes: false,
                allow_deletions: false,
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ success: true, result: [] }), {
            status: 200,
          });
        },
      },
    );
    const nonGet = methods.filter((m) => m !== "GET");
    expect(nonGet).toEqual(["POST"]);
    expect(plan.github.github_installation_token_minted).toBe(true);
    expect(plan.github.repo_exists).toBe(true);
    expect(plan.github.factory_owned).toBe(true);
    expect(plan.github.conflict_not_factory_owned).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(INSTALLATION_TOKEN);
  });
});
