import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { createProjectRepo } from "../../src/tools/create-project-repo.js";
import { createMockGitHub, fakePkcs8Pem } from "./github-mock.js";

const env: ProjectFactoryEnv = {
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProjectRepo", () => {
  it("dry_run makes no write calls", async () => {
    const writes: string[] = [];
    const github = await createMockGitHub((method, path) => {
      if (method !== "GET") {
        writes.push(`${method} ${path}`);
      }
      return { status: 404 };
    });
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-1",
        caller: "test",
        github,
      },
      {
        name: "demo-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );
    expect(writes).toEqual([]);
    expect(result).toMatchObject({ status: "planned", dry_run: true });
  });

  it("is idempotent for an existing factory-owned repo", async () => {
    const github = await createMockGitHub((method, path) => {
      if (method === "GET" && path === "/repos/didi-build/demo-app") {
        return { status: 200, body: { full_name: "didi-build/demo-app" } };
      }
      if (method === "GET" && path === "/repos/didi-build/demo-app/topics") {
        return { status: 200, body: { names: ["project-factory"] } };
      }
      if (method === "GET" && path.includes("/protection")) {
        return {
          status: 200,
          body: {
            required_status_checks: { strict: false, checks: [{ context: "check" }] },
            required_pull_request_reviews: { required_approving_review_count: 0 },
            allow_force_pushes: false,
            allow_deletions: false,
          },
        };
      }
      if (method === "GET" && path.endsWith("/README.md")) {
        return { status: 200, body: { content: btoa("# ok") } };
      }
      if (method === "GET" && path.endsWith("/wrangler.jsonc")) {
        return {
          status: 200,
          body: { content: btoa('{"name":"demo-app"}') },
        };
      }
      if (method === "POST" && path.endsWith("/labels")) {
        return { status: 422, body: { message: "already_exists" } };
      }
      return { status: 404 };
    });
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-2",
        caller: "test",
        github,
      },
      {
        name: "demo-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );
    expect(result).toMatchObject({
      status: "exists",
      repo_url: "https://github.com/didi-build/demo-app",
    });
  });

  it("writes an audit entry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const github = await createMockGitHub(() => ({ status: 404 }));
    await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-audit",
        caller: "bot",
        github,
      },
      {
        name: "demo-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );
    const auditLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes("factory_call"));
    expect(auditLine).toBeDefined();
    const parsed = JSON.parse(auditLine ?? "{}") as {
      event: string;
      tool: string;
      caller: string;
    };
    expect(parsed).toMatchObject({
      event: "factory_call",
      tool: "create_project_repo",
      caller: "bot",
    });
    expect(auditLine).not.toMatch(/installation-token|BEGIN PRIVATE KEY/i);
  });
});
