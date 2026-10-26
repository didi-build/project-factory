import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { projectStatus } from "../../src/tools/project-status.js";
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
});
