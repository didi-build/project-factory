import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { FACTORY_TOPIC } from "../../src/factory/constants.js";
import {
  ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
  REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
  REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
} from "../../src/factory/provision-constants.js";
import { provisionCloudflare } from "../../src/tools/provision-cloudflare.js";
import {
  EXPECTED_CF_PREVIEW_TOKEN_POLICY,
  EXPECTED_CF_TOKEN_POLICY,
  EXPECTED_PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
  EXPECTED_PROVISION_WRITE_INSTALLATION_TOKEN_PERMISSIONS,
} from "./expected-provision-payloads.js";
import { fakePkcs8Pem } from "./github-mock.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_GH_PRODUCTION_REVIEWER: "diadem-maintainer",
};

const INSTALLATION_TOKEN = "fake-provision-installation-token-do-not-leak";
const MINTED_CF_TOKEN = "minted-cf-deploy-token-value-do-not-leak";
const CF_FACTORY_TOKEN = "fake-factory-cf-token-do-not-leak";

let privateKeyPem: string;
let githubPublicKey: string;
let githubKeyId: string;

beforeAll(async () => {
  privateKeyPem = await fakePkcs8Pem();
  const keyPair = nacl.box.keyPair();
  githubPublicKey = encodeBase64(keyPair.publicKey);
  githubKeyId = "repo-key-1";
});

afterEach(() => {
  vi.restoreAllMocks();
});

type RecordedRequest = {
  method: string;
  url: string;
  body?: unknown;
};

function buildFetch(
  handler: (req: RecordedRequest) => { status: number; body?: unknown },
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown;
    if (init?.body) {
      if (typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else {
        body = init.body;
      }
    }
    const recorded = { method, url, body };
    const result = handler(recorded);
    if (result.status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(result.body ? JSON.stringify(result.body) : "", {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function githubHandlers(
  state: {
    factoryTopic: boolean;
    repoSecrets: string[];
    productionSecrets: string[];
    environments: string[];
  },
  requests: RecordedRequest[],
) {
  return (req: RecordedRequest) => {
    requests.push(req);
    if (req.url.includes("/app/installations/") && req.url.includes("access_tokens")) {
      return { status: 201, body: { token: INSTALLATION_TOKEN } };
    }
    if (req.url.endsWith("/users/diadem-maintainer")) {
      return { status: 200, body: { id: 4242, login: "diadem-maintainer" } };
    }
    if (req.url.endsWith("/repos/didi-build/demo-app")) {
      return { status: 200, body: { full_name: "didi-build/demo-app" } };
    }
    if (req.url.endsWith("/repos/didi-build/not-factory")) {
      return { status: 200, body: { full_name: "didi-build/not-factory" } };
    }
    if (req.url.endsWith("/topics")) {
      return {
        status: 200,
        body: { names: state.factoryTopic ? [FACTORY_TOPIC] : ["other"] },
      };
    }
    if (req.url.endsWith("/actions/secrets/public-key")) {
      return { status: 200, body: { key_id: githubKeyId, key: githubPublicKey } };
    }
    if (req.url.includes("/environments/production/secrets/public-key")) {
      return { status: 200, body: { key_id: githubKeyId, key: githubPublicKey } };
    }
    if (req.url.endsWith("/actions/secrets") && req.method === "GET") {
      return {
        status: 200,
        body: {
          secrets: state.repoSecrets.map((name) => ({ name })),
          total_count: state.repoSecrets.length,
        },
      };
    }
    if (req.url.match(/\/actions\/secrets\/[^/]+$/) && req.method === "GET") {
      const name = req.url.split("/").pop()!;
      const exists = state.repoSecrets.includes(name);
      return exists
        ? { status: 200, body: { name } }
        : { status: 404, body: { message: "Not Found" } };
    }
    if (req.url.includes("/environments/production/secrets") && req.method === "GET") {
      if (req.url.endsWith("/secrets")) {
        return {
          status: 200,
          body: {
            secrets: state.productionSecrets.map((name) => ({ name })),
            total_count: state.productionSecrets.length,
          },
        };
      }
      const name = req.url.split("/").pop()!;
      const exists = state.productionSecrets.includes(name);
      return exists
        ? { status: 200, body: { name } }
        : { status: 404, body: { message: "Not Found" } };
    }
    if (req.url.endsWith("/environments") && req.method === "GET") {
      return {
        status: 200,
        body: {
          environments: state.environments.map((name) => ({ name, id: 1 })),
          total_count: state.environments.length,
        },
      };
    }
    if (req.url.includes("/environments/") && req.method === "GET") {
      const envName = req.url.split("/environments/")[1]?.split("/")[0];
      if (envName && state.environments.includes(envName)) {
        return { status: 200, body: { name: envName, id: 1 } };
      }
      return { status: 404, body: { message: "Not Found" } };
    }
    if (req.method === "PUT" && req.url.includes("/actions/secrets/")) {
      const name = decodeURIComponent(req.url.split("/actions/secrets/")[1] ?? "");
      if (name && !state.repoSecrets.includes(name)) {
        state.repoSecrets.push(name);
      }
      return { status: 201, body: {} };
    }
    if (
      req.method === "PUT" &&
      req.url.includes("/environments/") &&
      req.url.includes("/secrets/")
    ) {
      const name = decodeURIComponent(req.url.split("/secrets/").pop() ?? "");
      if (name && !state.productionSecrets.includes(name)) {
        state.productionSecrets.push(name);
      }
      return { status: 201, body: {} };
    }
    if (
      req.method === "PUT" &&
      req.url.includes("/environments/") &&
      !req.url.includes("/secrets/")
    ) {
      const envName = req.url.split("/environments/")[1]?.split("/")[0];
      if (envName && !state.environments.includes(envName)) {
        state.environments.push(envName);
      }
      return { status: 200, body: { name: envName } };
    }
    if (req.url.includes("deployment-branch-policies") && req.method === "POST") {
      return { status: 200, body: { id: 1, name: "main" } };
    }
    return { status: 404, body: { message: "unmocked github" } };
  };
}

function cloudflareHandlers(requests: RecordedRequest[], workers: Set<string>) {
  return (req: RecordedRequest) => {
    requests.push(req);
    if (req.url.endsWith("/accounts") && req.method === "GET") {
      return {
        status: 200,
        body: { success: true, result: [{ id: "cf-account-1", name: "Didi Build" }] },
      };
    }
    if (req.url.endsWith("/workers/subdomain")) {
      return {
        status: 200,
        body: { success: true, result: { subdomain: "didi-build" } },
      };
    }
    if (req.url.includes("/workers/scripts/") && req.url.endsWith("/settings")) {
      const name = req.url.split("/workers/scripts/")[1]?.split("/")[0];
      if (name && workers.has(name)) {
        return {
          status: 200,
          body: { success: true, result: { tags: ["project-factory"] } },
        };
      }
      return {
        status: 404,
        body: { success: false, errors: [{ message: "not found" }] },
      };
    }
    if (req.url.includes("/workers/scripts/") && req.url.endsWith("/secrets")) {
      return { status: 200, body: { success: true, result: [] } };
    }
    if (req.url.includes("/tokens/permission_groups")) {
      return {
        status: 200,
        body: {
          success: true,
          result: [
            {
              id: "pg-workers-edit",
              name: "Workers Scripts Edit",
              scopes: ["account"],
            },
          ],
        },
      };
    }
    if (req.url.endsWith("/tokens") && req.method === "GET") {
      return { status: 200, body: { success: true, result: [] } };
    }
    if (req.url.endsWith("/tokens") && req.method === "POST") {
      return {
        status: 200,
        body: {
          success: true,
          result: { id: "cf-token-id-1", value: MINTED_CF_TOKEN },
        },
      };
    }
    if (req.url.includes("/workers/scripts/") && req.method === "PUT") {
      const name = req.url.split("/workers/scripts/")[1];
      if (name) {
        workers.add(name);
      }
      return { status: 200, body: { success: true, result: { id: name } } };
    }
    if (req.url.includes("/subdomain") && req.method === "POST") {
      return { status: 200, body: { success: true, result: {} } };
    }
    return {
      status: 404,
      body: { success: false, errors: [{ message: "unmocked cf" }] },
    };
  };
}

describe("provisionCloudflare", () => {
  it("dry_run makes no Cloudflare or GitHub writes except installation token mint", async () => {
    const requests: RecordedRequest[] = [];
    const workers = new Set<string>();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = {
      factoryTopic: true,
      repoSecrets: [],
      productionSecrets: [],
      environments: [],
    };
    const fetchImpl = buildFetch((req) => {
      if (req.url.includes("api.github.com")) {
        return githubHandlers(state, requests)(req);
      }
      return cloudflareHandlers(requests, workers)(req);
    });

    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-dry",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: true,
      },
    );

    const writes = requests.filter(
      (r) => r.method !== "GET" && !r.url.includes("/access_tokens"),
    );
    expect(writes).toHaveLength(0);

    const mint = requests.find((r) => r.url.includes("/access_tokens"));
    expect(mint?.body).toEqual({
      permissions: EXPECTED_PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
    });

    expect(result).toMatchObject({ status: "planned", dry_run: true });

    const serialized = JSON.stringify(result);
    const audit = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(serialized).not.toContain(INSTALLATION_TOKEN);
    expect(serialized).not.toContain(CF_FACTORY_TOKEN);
    expect(audit).not.toContain(INSTALLATION_TOKEN);
  });

  it("creates workers, environments, tokens, and secrets on first run", async () => {
    const requests: RecordedRequest[] = [];
    const workers = new Set<string>();
    const state = {
      factoryTopic: true,
      repoSecrets: [] as string[],
      productionSecrets: [] as string[],
      environments: [] as string[],
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = buildFetch((req) => {
      if (req.url.includes("api.github.com")) {
        return githubHandlers(state, requests)(req);
      }
      return cloudflareHandlers(requests, workers)(req);
    });

    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-create",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({
      status: "repaired",
      worker: { name: "demo-app" },
      preview_worker: { name: "demo-app-preview" },
    });

    expect(workers.has("demo-app")).toBe(true);
    expect(workers.has("demo-app-preview")).toBe(true);
    expect(state.repoSecrets).toEqual(
      expect.arrayContaining([
        REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
        REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
      ]),
    );
    expect(state.productionSecrets).toContain(
      ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION,
    );

    const mintBodies = requests
      .filter((r) => r.url.includes("/tokens") && r.method === "POST")
      .map((r) => r.body);
    expect(mintBodies).toHaveLength(2);
    expect(mintBodies[0]).toMatchObject({
      name: "project-factory-demo-app-deploy-preview",
      policies: [EXPECTED_CF_PREVIEW_TOKEN_POLICY],
    });
    expect(mintBodies[1]).toMatchObject({
      name: "project-factory-demo-app-deploy-production",
      policies: [EXPECTED_CF_TOKEN_POLICY],
    });

    const mintAudit = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('"event":"token_mint"'));
    expect(mintAudit).toHaveLength(2);
    expect(mintAudit.join("\n")).not.toContain(MINTED_CF_TOKEN);

    const ghMint = requests.find((r) => r.url.includes("/access_tokens"));
    expect(ghMint?.body).toEqual({
      permissions: EXPECTED_PROVISION_WRITE_INSTALLATION_TOKEN_PERMISSIONS,
    });

    const d1r2 = requests.filter(
      (r) => /\/d1\/|\/r2\//i.test(r.url) || /d1_|r2_/i.test(r.url),
    );
    expect(d1r2).toHaveLength(0);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MINTED_CF_TOKEN);
    expect(serialized).not.toContain(INSTALLATION_TOKEN);
  });

  it("rerun is idempotent and skips existing resources", async () => {
    const requests: RecordedRequest[] = [];
    const workers = new Set(["demo-app", "demo-app-preview"]);
    const state = {
      factoryTopic: true,
      repoSecrets: [
        REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
        REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
      ],
      productionSecrets: [ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION],
      environments: ["preview", "production"],
    };
    const fetchImpl = buildFetch((req) => {
      if (req.url.includes("api.github.com")) {
        return githubHandlers(state, requests)(req);
      }
      return cloudflareHandlers(requests, workers)(req);
    });

    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-exists",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ status: "exists" });
    const cfWrites = requests.filter(
      (r) => r.url.includes("cloudflare.com") && r.method === "PUT",
    );
    expect(cfWrites).toHaveLength(0);
    const tokenMints = requests.filter(
      (r) => r.url.includes("/tokens") && r.method === "POST",
    );
    expect(tokenMints).toHaveLength(0);
  });

  it("refuses non-factory repos", async () => {
    const requests: RecordedRequest[] = [];
    const workers = new Set<string>();
    const state = {
      factoryTopic: false,
      repoSecrets: [],
      productionSecrets: [],
      environments: [],
    };
    const fetchImpl = buildFetch((req) => {
      if (req.url.includes("api.github.com")) {
        return githubHandlers(state, requests)(req);
      }
      return cloudflareHandlers(requests, workers)(req);
    });

    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-conflict",
        caller: "test",
        fetchImpl,
      },
      {
        name: "not-factory",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({
      error: { code: "conflict_not_factory_owned" },
    });
    const cfCalls = requests.filter((r) => r.url.includes("cloudflare.com"));
    expect(cfCalls).toHaveLength(0);
  });

  it("returns missing_secret when Cloudflare token is absent", async () => {
    const result = await provisionCloudflare(
      {
        env: { ...env, PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem },
        requestId: "req-missing",
        caller: "test",
        fetchImpl: buildFetch(() => ({ status: 404, body: {} })),
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );
    expect(result).toMatchObject({
      error: {
        code: "missing_secret",
        message: "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN",
      },
    });
  });

  it("maps Cloudflare permission errors", async () => {
    const requests: RecordedRequest[] = [];
    const workers = new Set<string>();
    const state = {
      factoryTopic: true,
      repoSecrets: [],
      productionSecrets: [],
      environments: [],
    };
    const fetchImpl = buildFetch((req) => {
      if (req.url.includes("api.github.com")) {
        return githubHandlers(state, requests)(req);
      }
      if (req.url.endsWith("/accounts")) {
        return {
          status: 403,
          body: { success: false, errors: [{ message: "Forbidden" }] },
        };
      }
      return cloudflareHandlers(requests, workers)(req);
    });

    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-perm",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ error: { code: "permission_denied" } });
  });
});
