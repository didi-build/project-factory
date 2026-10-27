import sodium from "libsodium-wrappers";
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
  EXPECTED_CF_PREVIEW_TOKEN_POST_BODY,
  EXPECTED_CF_PRODUCTION_TOKEN_POST_BODY,
  EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG,
  EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG,
  EXPECTED_PRODUCTION_DEPLOYMENT_BRANCH_POLICY_BODY,
  EXPECTED_PRODUCTION_ENVIRONMENT_PUT_BODY,
  EXPECTED_PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS,
  EXPECTED_PROVISION_WRITE_INSTALLATION_TOKEN_PERMISSIONS,
} from "./expected-provision-payloads.js";
import { fakePkcs8Pem } from "./github-mock.js";

const REVIEWER_LOGIN = "diademshoukralla";
const REVIEWER_ID = 4242;

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_GH_PRODUCTION_REVIEWER: REVIEWER_LOGIN,
};

const INSTALLATION_TOKEN = "fake-provision-installation-token-do-not-leak";
const MINTED_CF_TOKEN = "minted-cf-deploy-token-value-do-not-leak";
const CF_FACTORY_TOKEN = "fake-factory-cf-token-do-not-leak";

let privateKeyPem: string;
let githubPublicKey: string;
let githubKeyId: string;

beforeAll(async () => {
  privateKeyPem = await fakePkcs8Pem();
  await sodium.ready;
  const keyPair = sodium.crypto_box_keypair();
  githubPublicKey = sodium.to_base64(
    keyPair.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
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

type GithubState = {
  factoryTopic: boolean;
  repoSecrets: string[];
  productionSecrets: string[];
  environments: string[];
  productionReview: {
    reviewerId: number | null;
    branchPolicies: string[];
    failReadBack?: boolean;
    verifyEnvironment403?: boolean;
    verifyBranchPolicies403?: boolean;
    failPreviewSecretPut?: boolean;
    productionEnvGetCount?: number;
  };
};

function productionEnvironmentGetBody(state: GithubState) {
  const reviewerId = state.productionReview.failReadBack
    ? 9999
    : state.productionReview.reviewerId;
  const protection_rules = state.productionReview.failReadBack
    ? []
    : reviewerId
      ? [
          {
            id: 1,
            type: "required_reviewers",
            reviewers: [
              {
                type: "User",
                reviewer: { id: reviewerId, login: REVIEWER_LOGIN },
              },
            ],
          },
        ]
      : [];
  return {
    name: "production",
    protection_rules,
    deployment_branch_policy: state.productionReview.failReadBack
      ? { protected_branches: true, custom_branch_policies: false }
      : { protected_branches: false, custom_branch_policies: true },
  };
}

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

function githubHandlers(state: GithubState, requests: RecordedRequest[]) {
  return (req: RecordedRequest) => {
    requests.push(req);
    if (req.url.includes("/app/installations/") && req.url.includes("access_tokens")) {
      return { status: 201, body: { token: INSTALLATION_TOKEN } };
    }
    if (req.url.endsWith(`/users/${REVIEWER_LOGIN}`)) {
      return { status: 200, body: { id: REVIEWER_ID, login: REVIEWER_LOGIN } };
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
    if (
      req.url.includes("/environments/production/deployment-branch-policies") &&
      req.method === "GET"
    ) {
      if (state.productionReview.verifyBranchPolicies403) {
        return { status: 403, body: { message: "Forbidden" } };
      }
      const policies = state.productionReview.failReadBack
        ? []
        : state.productionReview.branchPolicies.map((name) => ({
            name,
            type: "branch",
          }));
      return { status: 200, body: { branch_policies: policies } };
    }
    if (
      req.method === "GET" &&
      req.url.includes("/environments/production") &&
      !req.url.includes("/secrets") &&
      !req.url.includes("deployment-branch-policies")
    ) {
      if (!state.environments.includes("production")) {
        return { status: 404, body: { message: "Not Found" } };
      }
      if (state.productionReview.verifyEnvironment403) {
        const count = (state.productionReview.productionEnvGetCount ?? 0) + 1;
        state.productionReview.productionEnvGetCount = count;
        if (count > 1) {
          return { status: 403, body: { message: "Forbidden" } };
        }
      }
      return {
        status: 200,
        body: productionEnvironmentGetBody(state),
      };
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
      if (
        state.productionReview.failPreviewSecretPut &&
        name === REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW
      ) {
        return { status: 500, body: { message: "server error" } };
      }
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
      req.url.endsWith("/environments/production") &&
      !req.url.includes("/secrets/")
    ) {
      const body = req.body as {
        reviewers?: { type: string; id: number }[];
        deployment_branch_policy?: {
          protected_branches: boolean;
          custom_branch_policies: boolean;
        };
      };
      if (!state.environments.includes("production")) {
        state.environments.push("production");
      }
      const reviewer = body.reviewers?.[0];
      if (reviewer?.type === "User") {
        state.productionReview.reviewerId = reviewer.id;
      }
      return { status: 200, body: { name: "production" } };
    }
    if (
      req.method === "PUT" &&
      req.url.endsWith("/environments/preview") &&
      !req.url.includes("/secrets/")
    ) {
      if (!state.environments.includes("preview")) {
        state.environments.push("preview");
      }
      return { status: 200, body: { name: "preview" } };
    }
    if (
      req.url.includes("/environments/production/deployment-branch-policies") &&
      req.method === "POST"
    ) {
      const body = req.body as { name?: string };
      if (body.name && !state.productionReview.branchPolicies.includes(body.name)) {
        state.productionReview.branchPolicies.push(body.name);
      }
      return { status: 200, body: { id: 1, name: body.name ?? "main" } };
    }
    return { status: 404, body: { message: "unmocked github" } };
  };
}

type WorkerScriptRegistry = Map<string, string | undefined>;

function defaultWorkerTags(): WorkerScriptRegistry {
  return new Map([
    ["demo-app", EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG],
    ["demo-app-preview", EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG],
  ]);
}

function isWorkerScriptListRequest(url: string, method: string): boolean {
  if (method !== "GET" || !url.includes("/workers/scripts")) {
    return false;
  }
  const path = url.split("?")[0];
  return path.endsWith("/workers/scripts");
}

function cloudflareHandlers(
  requests: RecordedRequest[],
  workers: WorkerScriptRegistry,
) {
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
    if (isWorkerScriptListRequest(req.url, req.method)) {
      const scripts = [...workers.entries()].map(([id, tag]) =>
        tag === undefined ? { id } : { id, tag },
      );
      return { status: 200, body: { success: true, result: scripts } };
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
              id: "7e79ec33834341f28dd431ab73884400",
              name: "Individual Workers Editor",
              scopes: ["com.cloudflare.api.account.workers"],
            },
            {
              id: "pg-workers-scripts-read",
              name: "Workers Scripts Read",
              scopes: ["account"],
            },
          ],
        },
      };
    }
    if (req.url.includes("/tokens") && req.method === "GET") {
      return { status: 200, body: { success: true, result: [] } };
    }
    if (req.url.includes("/tokens/") && req.method === "DELETE") {
      return { status: 200, body: { success: true, result: {} } };
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
      const name = req.url.split("/workers/scripts/")[1]?.split("?")[0];
      if (name) {
        if (!workers.has(name)) {
          workers.set(
            name,
            name.endsWith("-preview")
              ? EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG
              : EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG,
          );
        }
        const tag = workers.get(name);
        return {
          status: 200,
          body: {
            success: true,
            result: tag === undefined ? { id: name } : { id: name, tag },
          },
        };
      }
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

function defaultGithubState(overrides?: Partial<GithubState>): GithubState {
  return {
    factoryTopic: true,
    repoSecrets: [],
    productionSecrets: [],
    environments: [],
    productionReview: { reviewerId: null, branchPolicies: [] },
    ...overrides,
  };
}

describe("provisionCloudflare", () => {
  it("dry_run makes no Cloudflare or GitHub writes except installation token mint", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = defaultGithubState();
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
    const workers = defaultWorkerTags();
    const state = defaultGithubState();
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
      status: "created",
      worker: { name: "demo-app" },
      preview_worker: { name: "demo-app-preview" },
    });

    const productionPut = requests.find(
      (r) => r.method === "PUT" && r.url.endsWith("/environments/production"),
    );
    expect(productionPut?.body).toEqual(EXPECTED_PRODUCTION_ENVIRONMENT_PUT_BODY);

    const branchPolicyPost = requests.find(
      (r) =>
        r.method === "POST" &&
        r.url.includes("/environments/production/deployment-branch-policies"),
    );
    expect(branchPolicyPost?.body).toEqual(
      EXPECTED_PRODUCTION_DEPLOYMENT_BRANCH_POLICY_BODY,
    );

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
      .filter((r) => r.url.endsWith("/tokens") && r.method === "POST")
      .map((r) => r.body);
    expect(mintBodies).toHaveLength(2);
    expect(mintBodies[0]).toEqual(EXPECTED_CF_PREVIEW_TOKEN_POST_BODY);
    expect(mintBodies[1]).toEqual(EXPECTED_CF_PRODUCTION_TOKEN_POST_BODY);

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

  it("fails closed with permission_denied when production environment GET returns 403", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState({
      productionReview: {
        reviewerId: REVIEWER_ID,
        branchPolicies: ["main"],
        verifyEnvironment403: true,
      },
      environments: ["preview", "production"],
    });
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
        requestId: "req-verify-403-env",
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
      error: {
        code: "permission_denied",
        message: "GET /repos/didi-build/demo-app/environments/production returned 403",
        step: "verify_production_environment",
      },
    });
    expect(state.productionSecrets).toHaveLength(0);
  });

  it("fails closed with permission_denied when deployment-branch-policies GET returns 403", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState({
      productionReview: {
        reviewerId: REVIEWER_ID,
        branchPolicies: ["main"],
        verifyBranchPolicies403: true,
      },
      environments: ["preview", "production"],
    });
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
        requestId: "req-verify-403-branches",
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
      error: {
        code: "permission_denied",
        message:
          "GET /repos/didi-build/demo-app/environments/production/deployment-branch-policies returned 403",
        step: "verify_production_environment",
      },
    });
    expect(state.productionSecrets).toHaveLength(0);
  });

  it("revokes minted preview token when GitHub secret PUT fails", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState({
      productionReview: {
        reviewerId: null,
        branchPolicies: [],
        failPreviewSecretPut: true,
      },
    });
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
        requestId: "req-revoke",
        caller: "test",
        fetchImpl,
      },
      {
        name: "demo-app",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-846",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ error: { step: "put_preview_secret" } });
    const deleted = requests.filter(
      (r) => r.method === "DELETE" && r.url.includes("/tokens/cf-token-id-1"),
    );
    expect(deleted).toHaveLength(1);
    const revokeAudit = logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('"event":"token_revoke"'));
    expect(revokeAudit).toHaveLength(1);
  });

  it("fails closed when production environment read-back does not match", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState({
      productionReview: { reviewerId: null, branchPolicies: [], failReadBack: true },
    });
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
        requestId: "req-verify-fail",
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
      error: { code: "upstream_error", step: "verify_production_environment" },
    });
    expect(state.productionSecrets).toHaveLength(0);
    const productionSecretPut = requests.find(
      (r) =>
        r.method === "PUT" &&
        r.url.includes("/environments/production/secrets/") &&
        r.url.includes(ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION),
    );
    expect(productionSecretPut).toBeUndefined();
  });

  it("fails closed without minting when worker script tag is missing", async () => {
    const requests: RecordedRequest[] = [];
    const workers: WorkerScriptRegistry = new Map([
      ["demo-app", undefined],
      ["demo-app-preview", undefined],
    ]);
    const state = defaultGithubState();
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
        requestId: "req-missing-tag",
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
      error: { step: "cf_worker_script_tag" },
    });
    const tokenMints = requests.filter(
      (r) => r.url.endsWith("/tokens") && r.method === "POST",
    );
    expect(tokenMints).toHaveLength(0);
    expect(state.productionSecrets).toHaveLength(0);
  });

  it("rerun is idempotent and skips existing resources", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState({
      repoSecrets: [
        REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW,
        REPO_SECRET_CLOUDFLARE_ACCOUNT_ID,
      ],
      productionSecrets: [ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION],
      environments: ["preview", "production"],
      productionReview: { reviewerId: REVIEWER_ID, branchPolicies: ["main"] },
    });
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
    const workers = defaultWorkerTags();
    const state = defaultGithubState({ factoryTopic: false });
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

  it("returns missing_secret when production reviewer var is unset", async () => {
    const result = await provisionCloudflare(
      {
        env: {
          ...env,
          PROJECT_FACTORY_GH_PRODUCTION_REVIEWER: undefined,
          PROJECT_FACTORY_GH_PRIVATE_KEY: privateKeyPem,
          PROJECT_FACTORY_CLOUDFLARE_API_TOKEN: CF_FACTORY_TOKEN,
        },
        requestId: "req-no-reviewer",
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
        message: "PROJECT_FACTORY_GH_PRODUCTION_REVIEWER",
      },
    });
  });

  it("maps Cloudflare permission errors", async () => {
    const requests: RecordedRequest[] = [];
    const workers = defaultWorkerTags();
    const state = defaultGithubState();
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
