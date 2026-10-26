import {
  assertMintPoliciesSafe,
  buildWorkerDeployTokenPolicies,
} from "./deploy-token-policy.js";
import { FACTORY_WORKER_TAG } from "../factory/provision-constants.js";
import type { ProjectFactoryEnv } from "../env.js";

export type CfError = {
  status: number;
  message: string;
  retryable: boolean;
};

type CfResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string };

const PLACEHOLDER_MODULE = "placeholder.mjs";
const PLACEHOLDER_SOURCE = `export default {
  async fetch() {
    return new Response("project-factory placeholder", { status: 200 });
  },
};`;

const COMPATIBILITY_DATE = "2026-06-11";

async function cfJson<T>(
  token: string,
  method: string,
  path: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<CfResult<T>> {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: {
    success?: boolean;
    errors?: { message: string; code?: number }[];
    result?: T;
  };
  try {
    parsed = text ? (JSON.parse(text) as typeof parsed) : {};
  } catch {
    return {
      ok: false,
      status: response.status,
      message: "response was not valid JSON",
    };
  }
  if (!response.ok || !parsed.success) {
    const message = parsed.errors?.[0]?.message ?? response.statusText;
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: parsed.result as T };
}

function mapCfFailure(
  result: { status: number; message: string },
  step: string,
): {
  error: { code: string; message: string; step: string; retryable: boolean };
} {
  const message = `${result.status} ${result.message}`;
  if (result.status === 403) {
    return {
      error: { code: "permission_denied", message, step, retryable: false },
    };
  }
  if (result.status === 429) {
    return { error: { code: "rate_limited", message, step, retryable: true } };
  }
  if (result.status >= 500) {
    return { error: { code: "upstream_error", message, step, retryable: true } };
  }
  return { error: { code: "upstream_error", message, step, retryable: false } };
}

export class CloudflareFactoryClient {
  private accountId: string | null = null;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, fetchImpl: typeof fetch = fetch) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  static fromEnv(
    env: ProjectFactoryEnv,
    fetchImpl?: typeof fetch,
  ):
    | { ok: true; client: CloudflareFactoryClient }
    | { ok: false; code: "missing_secret" } {
    const token = env.PROJECT_FACTORY_CLOUDFLARE_API_TOKEN;
    if (!token) {
      return { ok: false, code: "missing_secret" };
    }
    return { ok: true, client: new CloudflareFactoryClient(token, fetchImpl ?? fetch) };
  }

  async resolveAccountId(): Promise<
    | { ok: true; accountId: string }
    | { ok: false; error: ReturnType<typeof mapCfFailure> }
  > {
    if (this.accountId) {
      return { ok: true, accountId: this.accountId };
    }
    const accounts = await cfJson<{ id: string; name: string }[]>(
      this.token,
      "GET",
      "/accounts",
      this.fetchImpl,
    );
    if (!accounts.ok) {
      return { ok: false, error: mapCfFailure(accounts, "cf_accounts") };
    }
    if (accounts.data.length !== 1) {
      return {
        ok: false,
        error: mapCfFailure(
          {
            status: 400,
            message: `expected exactly one Cloudflare account, found ${accounts.data.length}`,
          },
          "cf_accounts",
        ),
      };
    }
    this.accountId = accounts.data[0].id;
    return { ok: true, accountId: this.accountId };
  }

  async getWorkersDevSubdomain(): Promise<
    | { ok: true; subdomain: string }
    | { ok: false; error: ReturnType<typeof mapCfFailure> }
  > {
    const account = await this.resolveAccountId();
    if (!account.ok) {
      return account;
    }
    const result = await cfJson<{ subdomain: string }>(
      this.token,
      "GET",
      `/accounts/${account.accountId}/workers/subdomain`,
      this.fetchImpl,
    );
    if (!result.ok) {
      return { ok: false, error: mapCfFailure(result, "cf_workers_subdomain") };
    }
    return { ok: true, subdomain: result.data.subdomain };
  }

  async workerExists(
    workerName: string,
  ): Promise<
    | { ok: true; exists: boolean; tags?: string[] }
    | { ok: false; error: ReturnType<typeof mapCfFailure> }
  > {
    const account = await this.resolveAccountId();
    if (!account.ok) {
      return account;
    }
    const settings = await cfJson<{ tags?: string[] }>(
      this.token,
      "GET",
      `/accounts/${account.accountId}/workers/scripts/${workerName}/settings`,
      this.fetchImpl,
    );
    if (settings.ok) {
      return { ok: true, exists: true, tags: settings.data.tags ?? [] };
    }
    if (settings.status === 404) {
      return { ok: true, exists: false };
    }
    return { ok: false, error: mapCfFailure(settings, "cf_worker_settings") };
  }

  async ensurePlaceholderWorker(
    workerName: string,
  ): Promise<
    | { ok: true; created: boolean }
    | { ok: false; error: ReturnType<typeof mapCfFailure> }
  > {
    const existing = await this.workerExists(workerName);
    if (!existing.ok) {
      return existing;
    }
    if (existing.exists) {
      return { ok: true, created: false };
    }
    const account = await this.resolveAccountId();
    if (!account.ok) {
      return account;
    }
    const metadata = {
      main_module: PLACEHOLDER_MODULE,
      compatibility_date: COMPATIBILITY_DATE,
      tags: [FACTORY_WORKER_TAG],
    };
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    form.append(
      PLACEHOLDER_MODULE,
      new Blob([PLACEHOLDER_SOURCE], { type: "application/javascript+module" }),
      PLACEHOLDER_MODULE,
    );
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${account.accountId}/workers/scripts/${workerName}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      },
    );
    const text = await response.text();
    let parsed: { success?: boolean; errors?: { message: string }[] };
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      return {
        ok: false,
        error: mapCfFailure(
          { status: response.status, message: "invalid JSON uploading worker" },
          "cf_upload_worker",
        ),
      };
    }
    if (!response.ok || !parsed.success) {
      const message = parsed.errors?.[0]?.message ?? response.statusText;
      return {
        ok: false,
        error: mapCfFailure({ status: response.status, message }, "cf_upload_worker"),
      };
    }
    const subdomain = await cfJson<unknown>(
      this.token,
      "POST",
      `/accounts/${account.accountId}/workers/scripts/${workerName}/subdomain`,
      this.fetchImpl,
      { enabled: true },
    );
    if (!subdomain.ok && subdomain.status !== 409) {
      return { ok: false, error: mapCfFailure(subdomain, "cf_workers_dev") };
    }
    return { ok: true, created: true };
  }

  async mintWorkerDeployToken(
    workerName: string,
    tokenName: string,
  ): Promise<
    | { ok: true; tokenId: string; tokenValue: string; created: boolean }
    | { ok: false; error: ReturnType<typeof mapCfFailure> }
  > {
    const account = await this.resolveAccountId();
    if (!account.ok) {
      return account;
    }
    const listed = await cfJson<{ id: string; name: string }[]>(
      this.token,
      "GET",
      `/accounts/${account.accountId}/tokens`,
      this.fetchImpl,
    );
    if (listed.ok) {
      const found = listed.data.find((t) => t.name === tokenName);
      if (found) {
        return {
          ok: false,
          error: mapCfFailure(
            {
              status: 409,
              message:
                "deploy token already exists but value is not retrievable; set GitHub secret manually or delete the token",
            },
            "cf_mint_token",
          ),
        };
      }
    }

    const permissionGroups = await cfJson<
      { id: string; name: string; scopes: string[] }[]
    >(
      this.token,
      "GET",
      `/accounts/${account.accountId}/tokens/permission_groups`,
      this.fetchImpl,
    );
    if (!permissionGroups.ok) {
      return {
        ok: false,
        error: mapCfFailure(permissionGroups, "cf_permission_groups"),
      };
    }
    const workersEditor = permissionGroups.data.find(
      (g) => g.name === "Workers Editor" || g.name === "Individual Workers Editor",
    );
    const workersScriptsRead = permissionGroups.data.find(
      (g) => g.name === "Workers Scripts Read",
    );
    if (!workersEditor || !workersScriptsRead) {
      return {
        ok: false,
        error: mapCfFailure(
          {
            status: 400,
            message:
              "Workers Editor or Workers Scripts Read permission group not found",
          },
          "cf_permission_groups",
        ),
      };
    }

    const policies = buildWorkerDeployTokenPolicies(account.accountId, workerName, {
      workersEditor: { id: workersEditor.id, name: workersEditor.name },
      workersScriptsRead: {
        id: workersScriptsRead.id,
        name: workersScriptsRead.name,
      },
    });
    try {
      assertMintPoliciesSafe(policies);
    } catch (err) {
      return {
        ok: false,
        error: mapCfFailure(
          {
            status: 400,
            message: err instanceof Error ? err.message : "unsafe mint policy",
          },
          "cf_mint_token",
        ),
      };
    }

    const create = await cfJson<{ id: string; value: string }>(
      this.token,
      "POST",
      `/accounts/${account.accountId}/tokens`,
      this.fetchImpl,
      {
        name: tokenName,
        policies,
      },
    );
    if (!create.ok) {
      return { ok: false, error: mapCfFailure(create, "cf_mint_token") };
    }
    return {
      ok: true,
      tokenId: create.data.id,
      tokenValue: create.data.value,
      created: true,
    };
  }
}

export { mapCfFailure };
