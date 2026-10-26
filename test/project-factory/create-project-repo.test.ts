import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { targetBranchProtectionPayload } from "../../src/factory/branch-protection.js";
import { FACTORY_TOPIC } from "../../src/factory/constants.js";
import { STANDARD_FACTORY_LABELS } from "../../src/factory/labels.js";
import { DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS } from "../../src/github/dry-run-installation.js";
import { createProjectRepo } from "../../src/tools/create-project-repo.js";
import {
  createMockGitHub,
  fakePkcs8Pem,
  type RecordedGithubCall,
} from "./github-mock.js";
import { githubBranchProtectionApiBody } from "./github-fixtures.js";

const env: ProjectFactoryEnv = {
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

afterEach(() => {
  vi.restoreAllMocks();
});

type RecordedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

function buildDryRunFetch(
  handler: (req: RecordedRequest) => { status: number; body?: unknown },
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    if (init?.body) {
      body = JSON.parse(String(init.body));
    }
    const recorded = { method, url, body };
    const result = handler(recorded);
    if (result.status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(result.body ? JSON.stringify(result.body) : "", {
      status: result.status,
    });
  };
}

describe("createProjectRepo", () => {
  it("dry_run mints one read-only installation token and uses GET only afterward", async () => {
    const requests: RecordedRequest[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = buildDryRunFetch((req) => {
      requests.push(req);
      if (
        req.url.includes("/app/installations/") &&
        req.url.includes("access_tokens")
      ) {
        return { status: 201, body: { token: INSTALLATION_TOKEN } };
      }
      if (req.url.includes("/app/installations/")) {
        return {
          status: 200,
          body: {
            id: 175254357,
            account: { login: "didi-build" },
            repository_selection: "all",
          },
        };
      }
      if (req.url.endsWith("/repos/didi-build/demo-app")) {
        return { status: 404, body: { message: "Not Found" } };
      }
      if (req.url.includes("cloudflare.com") && req.url.endsWith("/accounts")) {
        return {
          status: 200,
          body: { success: true, result: [{ id: "cf-account-1", name: "Didi Build" }] },
        };
      }
      if (
        req.url.includes("/workers/scripts/demo-app") &&
        req.url.endsWith("/secrets")
      ) {
        return { status: 200, body: { success: true, result: [] } };
      }
      if (req.url.includes("/workers/scripts/demo-app")) {
        return {
          status: 404,
          body: { success: false, errors: [{ message: "not found" }] },
        };
      }
      return { status: 404, body: {} };
    });

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

    const nonGet = requests.filter((r) => r.method !== "GET");
    expect(nonGet).toHaveLength(1);
    expect(nonGet[0].url).toContain("/access_tokens");
    expect(nonGet[0].body).toEqual({
      permissions: DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
    });
    expect(nonGet[0].body).not.toHaveProperty("repositories");

    const cloudflareWrites = requests.filter(
      (r) =>
        r.url.includes("cloudflare.com") && r.method !== "GET" && r.method !== "HEAD",
    );
    expect(cloudflareWrites).toHaveLength(0);

    expect(result).toMatchObject({
      status: "planned",
      dry_run: true,
      github: {
        github_installation_token_minted: true,
        repo_exists: false,
        factory_owned: false,
        conflict_not_factory_owned: false,
      },
    });

    const serialized = JSON.stringify(result);
    const auditLine = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(serialized).not.toContain(INSTALLATION_TOKEN);
    expect(auditLine).not.toContain(INSTALLATION_TOKEN);
    expect(auditLine).toContain('"github_installation_token_minted":true');
    expect(auditLine).toContain('"metadata":"read"');
  });

  it("dry_run reports conflict when repo exists without factory topic", async () => {
    const fetchImpl = buildDryRunFetch((req) => {
      if (req.url.includes("access_tokens")) {
        return { status: 201, body: { token: INSTALLATION_TOKEN } };
      }
      if (req.url.includes("/app/installations/")) {
        return { status: 200, body: { id: 1, account: { login: "didi-build" } } };
      }
      if (req.url.endsWith("/repos/didi-build/conflict-app")) {
        return { status: 200, body: { full_name: "didi-build/conflict-app" } };
      }
      if (req.url.endsWith("/topics")) {
        return { status: 200, body: { names: ["other"] } };
      }
      if (req.url.includes("/protection")) {
        return { status: 404, body: { message: "Branch not protected" } };
      }
      return { status: 200, body: { success: true, result: [] } };
    });

    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-conflict",
        caller: "test",
        fetchImpl,
      },
      {
        name: "conflict-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );

    expect(result).toMatchObject({
      github: {
        repo_exists: true,
        factory_owned: false,
        conflict_not_factory_owned: true,
      },
    });
  });

  it("is idempotent for an existing factory-owned repo", async () => {
    const calls: RecordedGithubCall[] = [];
    const github = await createMockGitHub((method, path) => {
      if (method === "GET" && path === "/repos/didi-build/demo-app") {
        return { status: 200, body: { full_name: "didi-build/demo-app" } };
      }
      if (method === "GET" && path === "/repos/didi-build/demo-app/topics") {
        return { status: 200, body: { names: ["project-factory"] } };
      }
      if (method === "GET" && path.includes("/protection")) {
        return { status: 200, body: githubBranchProtectionApiBody() };
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
    }, calls);
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
    const apiCalls = calls.filter((c) => !c.path.includes("/access_tokens"));
    expect(apiCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /repos/didi-build/demo-app",
      "GET /repos/didi-build/demo-app/topics",
      "GET /repos/didi-build/demo-app/topics",
      "GET /repos/didi-build/demo-app/branches/main/protection",
      `POST /repos/didi-build/demo-app/labels`,
      `POST /repos/didi-build/demo-app/labels`,
      `POST /repos/didi-build/demo-app/labels`,
      "GET /repos/didi-build/demo-app/contents/README.md",
      "GET /repos/didi-build/demo-app/contents/wrangler.jsonc",
      "GET /repos/didi-build/demo-app/branches/main/protection",
    ]);
  });

  it("creates a new repo with expected GitHub write payloads", async () => {
    const calls: RecordedGithubCall[] = [];
    let protectionReads = 0;
    const github = await createMockGitHub((method, path) => {
      if (method === "GET" && path === "/repos/didi-build/fresh-app") {
        return { status: 404, body: { message: "Not Found" } };
      }
      if (method === "POST" && path.includes("/generate")) {
        return { status: 201, body: { full_name: "didi-build/fresh-app" } };
      }
      if (method === "PUT" && path.endsWith("/topics")) {
        return { status: 204 };
      }
      if (method === "GET" && path.includes("/protection")) {
        protectionReads += 1;
        if (protectionReads === 1) {
          return { status: 200, body: { allow_force_pushes: { enabled: true } } };
        }
        return { status: 200, body: githubBranchProtectionApiBody() };
      }
      if (method === "PUT" && path.includes("/protection")) {
        return { status: 200, body: githubBranchProtectionApiBody() };
      }
      if (method === "POST" && path.endsWith("/labels")) {
        return { status: 201, body: {} };
      }
      if (method === "GET" && path.endsWith("/README.md")) {
        return { status: 200, body: { content: btoa("# ok") } };
      }
      if (method === "GET" && path.endsWith("/wrangler.jsonc")) {
        return {
          status: 200,
          body: { content: btoa('{"name":"fresh-app"}') },
        };
      }
      return { status: 404 };
    }, calls);
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-fresh",
        caller: "test",
        github,
      },
      {
        name: "fresh-app",
        description: "Fresh project",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-99",
        dry_run: false,
      },
    );
    expect(result).toMatchObject({
      status: "created",
      repo_url: "https://github.com/didi-build/fresh-app",
      dry_run: false,
    });
    const generate = calls.find(
      (c) => c.method === "POST" && c.path.includes("/generate"),
    );
    expect(generate?.body).toEqual({
      owner: "didi-build",
      name: "fresh-app",
      description: "Fresh project",
      private: false,
      include_all_branches: false,
    });
    const topicPut = calls.find(
      (c) => c.method === "PUT" && c.path.endsWith("/topics"),
    );
    expect(topicPut?.body).toEqual({ names: [FACTORY_TOPIC] });
    const protectionPut = calls.find(
      (c) => c.method === "PUT" && c.path.includes("/protection"),
    );
    expect(protectionPut?.body).toEqual(targetBranchProtectionPayload());
    const labelPosts = calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/labels"),
    );
    expect(labelPosts).toHaveLength(3);
    expect(labelPosts.map((c) => c.body)).toEqual(STANDARD_FACTORY_LABELS);
  });

  it("returns pending_bootstrap when protection is 404 right after generate", async () => {
    const github = await createMockGitHub((method, path) => {
      if (method === "GET" && path === "/repos/didi-build/async-app") {
        return { status: 404, body: { message: "Not Found" } };
      }
      if (method === "POST" && path.includes("/generate")) {
        return { status: 201, body: { full_name: "didi-build/async-app" } };
      }
      if (method === "PUT" && path.endsWith("/topics")) {
        return { status: 204 };
      }
      if (method === "GET" && path.includes("/protection")) {
        return { status: 404, body: { message: "Branch not found" } };
      }
      return { status: 404 };
    });
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-pending",
        caller: "test",
        github,
      },
      {
        name: "async-app",
        description: "Async bootstrap",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-2",
        dry_run: false,
      },
    );
    expect(result).toMatchObject({
      status: "pending_bootstrap",
      repo_url: "https://github.com/didi-build/async-app",
    });
  });

  it("rejects invalid and reserved names with no GitHub API calls", async () => {
    const fetchImpl = async () => {
      throw new Error("GitHub fetch must not run for invalid names");
    };
    for (const name of ["ab", "launchpad", "pr-foo"]) {
      const result = await createProjectRepo(
        {
          env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
          requestId: `req-invalid-${name}`,
          caller: "test",
          fetchImpl,
        },
        {
          name,
          description: "Demo",
          approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
          dry_run: false,
        },
      );
      expect(result).toHaveProperty("error");
    }
  });

  it("returns upstream_error on GET 502 without adopting the repo on 422", async () => {
    const writes: string[] = [];
    const github = await createMockGitHub((method, path) => {
      if (method !== "GET") {
        writes.push(`${method} ${path}`);
      }
      if (method === "GET" && path === "/repos/didi-build/demo-app") {
        return { status: 502, body: { message: "bad gateway" } };
      }
      if (method === "POST" && path.includes("/generate")) {
        return { status: 422, body: { message: "name already exists" } };
      }
      return { status: 404 };
    });
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-502",
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
      error: { code: "upstream_error", step: "read_repo" },
    });
    expect(
      writes.filter((w) => w.startsWith("POST") && w.includes("generate")),
    ).toHaveLength(0);
    expect(writes.filter((w) => w.startsWith("PUT"))).toHaveLength(0);
  });

  it("writes audit on conflict_not_factory_owned", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const github = await createMockGitHub((method, path) => {
      if (method === "GET" && path === "/repos/didi-build/conflict-app") {
        return { status: 200, body: { full_name: "didi-build/conflict-app" } };
      }
      if (method === "GET" && path.endsWith("/topics")) {
        return { status: 200, body: { names: [] } };
      }
      return { status: 404 };
    });
    const result = await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-conflict-audit",
        caller: "test",
        github,
      },
      {
        name: "conflict-app",
        description: "Demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );
    expect(result).toMatchObject({ error: { code: "conflict_not_factory_owned" } });
    const auditLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes("factory_call"));
    expect(auditLine).toContain('"status":"conflict_not_factory_owned"');
    expect(auditLine).toContain('"failed_step":"read_topics"');
  });

  it("writes an audit entry", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = buildDryRunFetch((req) => {
      if (req.url.includes("access_tokens")) {
        return { status: 201, body: { token: INSTALLATION_TOKEN } };
      }
      if (req.url.includes("/app/installations/")) {
        return { status: 200, body: { id: 1, account: { login: "didi-build" } } };
      }
      if (req.url.endsWith("/repos/didi-build/demo-app")) {
        return { status: 404 };
      }
      return { status: 200, body: { success: true, result: [] } };
    });
    await createProjectRepo(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-audit",
        caller: "bot",
        fetchImpl,
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
      github_installation_token_minted?: boolean;
    };
    expect(parsed).toMatchObject({
      event: "factory_call",
      tool: "create_project_repo",
      caller: "bot",
      github_installation_token_minted: true,
    });
    expect(auditLine).not.toContain(INSTALLATION_TOKEN);
  });
});
