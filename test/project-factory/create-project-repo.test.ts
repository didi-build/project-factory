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
  it("dry_run uses only GET and does not mint installation tokens", async () => {
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      methods.push(method);
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/app/installations/") && !url.includes("access_tokens")) {
        return new Response(
          JSON.stringify({
            id: 175254357,
            account: { login: "didi-build" },
            repository_selection: "all",
          }),
          { status: 200 },
        );
      }
      if (url.includes("access_tokens")) {
        return new Response("unexpected token mint", { status: 500 });
      }
      if (url.endsWith("/accounts") && url.includes("cloudflare.com")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "cf-account-1", name: "Didi Build" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/workers/scripts/demo-app") && url.endsWith("/secrets")) {
        return new Response(JSON.stringify({ success: true, result: [] }), {
          status: 200,
        });
      }
      if (url.includes("/workers/scripts/demo-app")) {
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "not found" }] }),
          {
            status: 404,
          },
        );
      }
      return new Response("{}", { status: 404 });
    };
    const result = await createProjectRepo(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: "fake-cf-token",
        },
        requestId: "req-1",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(result).toMatchObject({
      status: "planned",
      dry_run: true,
      github: {
        installation_read_ok: true,
        repo_exists: null,
        reads_requiring_installation_token: expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/repos/didi-build/demo-app",
          }),
        ]),
      },
      cloudflare: { worker_exists: false, worker_secret_names: [] },
    });
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
