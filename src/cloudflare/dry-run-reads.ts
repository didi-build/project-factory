import type { ProjectFactoryEnv } from "../env.js";

export type CloudflareDryRunRead = {
  account_id?: string;
  worker_name: string;
  worker_exists?: boolean;
  worker_secret_names?: string[];
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
  const body = (await response.json()) as {
    success?: boolean;
    errors?: { message: string }[];
    result?: T;
  };
  if (!response.ok || !body.success) {
    const message = body.errors?.[0]?.message ?? response.statusText;
    return { ok: false, status: response.status, message };
  }
  return { ok: true, data: body.result as T };
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

  const script = await cfGet<unknown>(
    token,
    `/accounts/${accountId}/workers/scripts/${workerName}`,
    fetchImpl,
  );
  if (script.ok) {
    out.worker_exists = true;
  } else if (script.status === 404) {
    out.worker_exists = false;
  } else {
    out.error = `GET worker script failed: ${script.message}`;
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
  } else {
    out.error = `GET worker secrets failed: ${secrets.message}`;
  }

  return out;
}
