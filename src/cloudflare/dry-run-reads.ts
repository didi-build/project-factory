import type { ProjectFactoryEnv } from "../env.js";
import { trimmedHttpDetail } from "../github/github-errors.js";

export type CloudflareDryRunRead = {
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
      message: trimmedHttpDetail(response.status, "invalid_json"),
    };
  }
  if (!response.ok || !body.success) {
    return {
      ok: false,
      status: response.status,
      message: trimmedHttpDetail(response.status, "cloudflare_error"),
    };
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
    out.error = `accounts ${accounts.message}`;
    return out;
  }
  if (accounts.data.length !== 1) {
    out.error = trimmedHttpDetail(400, "account_count");
    return out;
  }
  const accountId = accounts.data[0].id;

  const settings = await cfGet<unknown>(
    token,
    `/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    fetchImpl,
  );
  if (settings.ok) {
    out.worker_exists = true;
  } else if (settings.status === 404) {
    out.worker_exists = false;
  } else {
    out.error = `worker_settings ${settings.message}`;
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
    out.error = `worker_secrets ${secrets.message}`;
  }

  return out;
}
