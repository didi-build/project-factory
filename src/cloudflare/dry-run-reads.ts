import type { ProjectFactoryEnv } from "../env.js";
import { FACTORY_WORKER_TAG } from "../factory/provision-constants.js";

export type CloudflareDryRunRead = {
  account_id?: string;
  worker_name: string;
  worker_exists?: boolean;
  worker_secret_names?: string[];
  conflict_not_factory_owned?: boolean;
  skipped?: string;
  error?: string;
};

type CfResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string };

async function cfGet<T>(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<CfResult<T>> {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let body: {
    success?: boolean;
    errors?: { message: string }[];
    result?: T;
  };
  try {
    body = text ? (JSON.parse(text) as typeof body) : {};
  } catch {
    return {
      ok: false,
      status: response.status,
      message: "response was not valid JSON",
    };
  }
  if (!response.ok || !body.success) {
    const message = body.errors?.[0]?.message ?? response.statusText;
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: body.result as T };
}

export async function readWorkerDryRunState(
  token: string,
  accountId: string,
  workerName: string,
  fetchImpl: typeof fetch,
): Promise<{
  worker_exists?: boolean;
  worker_secret_names?: string[];
  conflict_not_factory_owned?: boolean;
  error?: string;
}> {
  const out: {
    worker_exists?: boolean;
    worker_secret_names?: string[];
    conflict_not_factory_owned?: boolean;
    error?: string;
  } = {};

  const settings = await cfGet<{ tags?: string[] }>(
    token,
    `/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    fetchImpl,
  );
  if (settings.ok) {
    out.worker_exists = true;
    const tags = settings.data?.tags ?? [];
    if (!tags.includes(FACTORY_WORKER_TAG)) {
      out.conflict_not_factory_owned = true;
    }
  } else if (settings.status === 404) {
    out.worker_exists = false;
  } else {
    out.error = `GET worker settings failed: ${settings.message}`;
    return out;
  }

  const secrets = await cfGet<{ name: string }[]>(
    token,
    `/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
    fetchImpl,
  );
  if (secrets.ok) {
    out.worker_secret_names = secrets.data.map((s) => s.name).sort();
  } else if (secrets.status === 404 && out.worker_exists === false) {
    out.worker_secret_names = [];
  } else if (!out.error) {
    out.error = `GET worker secrets failed: ${secrets.message}`;
  }

  return out;
}

export async function cloudflareDryRunReads(
  env: ProjectFactoryEnv,
  workerName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudflareDryRunRead> {
  const out: CloudflareDryRunRead = { worker_name: workerName };
  const token = env.PROJECT_FACTORY_CLOUDFLARE_API_TOKEN;
  if (!token) {
    out.skipped = "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN not set";
    return out;
  }

  const accounts = await cfGet<{ id: string; name: string }[]>(
    token,
    "/accounts",
    fetchImpl,
  );
  if (!accounts.ok) {
    out.error = `GET /accounts failed: ${accounts.message}`;
    return out;
  }
  if (accounts.data.length !== 1) {
    out.error = `expected exactly one Cloudflare account, found ${accounts.data.length}`;
    return out;
  }
  const accountId = accounts.data[0].id;
  out.account_id = accountId;

  const workerState = await readWorkerDryRunState(
    token,
    accountId,
    workerName,
    fetchImpl,
  );
  if (workerState.error) {
    out.error = workerState.error;
    return out;
  }
  out.worker_exists = workerState.worker_exists;
  out.worker_secret_names = workerState.worker_secret_names;
  if (workerState.conflict_not_factory_owned) {
    out.conflict_not_factory_owned = true;
  }

  return out;
}

export type ProvisionWorkersDryRunRead = {
  account_id?: string;
  production: CloudflareDryRunRead;
  preview: CloudflareDryRunRead;
  conflict_not_factory_owned: boolean;
  skipped?: string;
  warnings: string[];
};

export async function provisionWorkersDryRunReads(
  env: ProjectFactoryEnv,
  productionName: string,
  previewName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProvisionWorkersDryRunRead> {
  const warnings: string[] = [];
  const token = env.PROJECT_FACTORY_CLOUDFLARE_API_TOKEN;
  if (!token) {
    return {
      production: {
        worker_name: productionName,
        skipped: "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN not set",
      },
      preview: {
        worker_name: previewName,
        skipped: "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN not set",
      },
      conflict_not_factory_owned: false,
      skipped: "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN not set",
      warnings: ["PROJECT_FACTORY_CLOUDFLARE_API_TOKEN not set"],
    };
  }

  const accounts = await cfGet<{ id: string; name: string }[]>(
    token,
    "/accounts",
    fetchImpl,
  );
  if (!accounts.ok) {
    warnings.push(`GET /accounts failed: ${accounts.message}`);
    return {
      production: {
        worker_name: productionName,
        error: `GET /accounts failed: ${accounts.message}`,
      },
      preview: {
        worker_name: previewName,
        error: `GET /accounts failed: ${accounts.message}`,
      },
      conflict_not_factory_owned: false,
      warnings,
    };
  }
  if (accounts.data.length !== 1) {
    const msg = `expected exactly one Cloudflare account, found ${accounts.data.length}`;
    warnings.push(msg);
    return {
      production: { worker_name: productionName, error: msg },
      preview: { worker_name: previewName, error: msg },
      conflict_not_factory_owned: false,
      warnings,
    };
  }
  const accountId = accounts.data[0].id;

  const productionState = await readWorkerDryRunState(
    token,
    accountId,
    productionName,
    fetchImpl,
  );
  const previewState = await readWorkerDryRunState(
    token,
    accountId,
    previewName,
    fetchImpl,
  );

  if (productionState.error) {
    warnings.push(productionState.error);
  }
  if (previewState.error) {
    warnings.push(previewState.error);
  }

  const conflictNotFactoryOwned =
    productionState.conflict_not_factory_owned === true ||
    previewState.conflict_not_factory_owned === true;

  return {
    account_id: accountId,
    production: {
      worker_name: productionName,
      account_id: accountId,
      worker_exists: productionState.worker_exists,
      worker_secret_names: productionState.worker_secret_names,
      conflict_not_factory_owned: productionState.conflict_not_factory_owned,
      error: productionState.error,
    },
    preview: {
      worker_name: previewName,
      account_id: accountId,
      worker_exists: previewState.worker_exists,
      worker_secret_names: previewState.worker_secret_names,
      conflict_not_factory_owned: previewState.conflict_not_factory_owned,
      error: previewState.error,
    },
    conflict_not_factory_owned: conflictNotFactoryOwned,
    warnings,
  };
}
