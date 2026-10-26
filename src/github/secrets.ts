import { decodeBase64, encodeBase64 } from "tweetnacl-util";
import sodium from "tweetsodium";
import type { GitHubClient } from "./client.js";
import { mapGithubFailure } from "./github-errors.js";

export function sealGitHubSecret(plaintext: string, publicKeyBase64: string): string {
  const key = decodeBase64(publicKeyBase64);
  const message = new TextEncoder().encode(plaintext);
  const sealed = sodium.seal(message, key);
  return encodeBase64(sealed);
}

export async function putRepoSecret(
  github: GitHubClient,
  repoFull: string,
  secretName: string,
  plaintext: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof mapGithubFailure> }> {
  const keyResult = await github.request(
    "GET",
    `/repos/${repoFull}/actions/secrets/public-key`,
  );
  if (!keyResult.ok) {
    return {
      ok: false,
      error: mapGithubFailure(keyResult.error, "get_repo_secret_key"),
    };
  }
  const { key_id, key } = keyResult.data as { key_id: string; key: string };
  const encrypted = sealGitHubSecret(plaintext, key);
  const put = await github.request(
    "PUT",
    `/repos/${repoFull}/actions/secrets/${secretName}`,
    {
      encrypted_value: encrypted,
      key_id,
    },
  );
  if (!put.ok) {
    return { ok: false, error: mapGithubFailure(put.error, "put_repo_secret") };
  }
  return { ok: true };
}

export async function putEnvironmentSecret(
  github: GitHubClient,
  repoFull: string,
  environment: string,
  secretName: string,
  plaintext: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof mapGithubFailure> }> {
  const keyResult = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${environment}/secrets/public-key`,
  );
  if (!keyResult.ok) {
    return {
      ok: false,
      error: mapGithubFailure(keyResult.error, "get_environment_secret_key"),
    };
  }
  const { key_id, key } = keyResult.data as { key_id: string; key: string };
  const encrypted = sealGitHubSecret(plaintext, key);
  const put = await github.request(
    "PUT",
    `/repos/${repoFull}/environments/${environment}/secrets/${secretName}`,
    {
      encrypted_value: encrypted,
      key_id,
    },
  );
  if (!put.ok) {
    return { ok: false, error: mapGithubFailure(put.error, "put_environment_secret") };
  }
  return { ok: true };
}

export async function listRepoSecretNames(
  github: GitHubClient,
  repoFull: string,
): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request("GET", `/repos/${repoFull}/actions/secrets`);
  if (!result.ok) {
    return { ok: false, error: mapGithubFailure(result.error, "list_repo_secrets") };
  }
  const secrets =
    result.data && typeof result.data === "object"
      ? ((result.data as { secrets?: { name: string }[] }).secrets ?? [])
      : [];
  return { ok: true, names: secrets.map((s) => s.name).sort() };
}

export async function listEnvironmentSecretNames(
  github: GitHubClient,
  repoFull: string,
  environment: string,
): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${environment}/secrets`,
  );
  if (!result.ok) {
    return {
      ok: false,
      error: mapGithubFailure(result.error, "list_environment_secrets"),
    };
  }
  const secrets =
    result.data && typeof result.data === "object"
      ? ((result.data as { secrets?: { name: string }[] }).secrets ?? [])
      : [];
  return { ok: true, names: secrets.map((s) => s.name).sort() };
}

export async function repoSecretExists(
  github: GitHubClient,
  repoFull: string,
  secretName: string,
): Promise<
  | { ok: true; exists: boolean }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request(
    "GET",
    `/repos/${repoFull}/actions/secrets/${secretName}`,
  );
  if (result.ok) {
    return { ok: true, exists: true };
  }
  if (result.error.status === 404) {
    return { ok: true, exists: false };
  }
  return { ok: false, error: mapGithubFailure(result.error, "get_repo_secret") };
}

export async function environmentSecretExists(
  github: GitHubClient,
  repoFull: string,
  environment: string,
  secretName: string,
): Promise<
  | { ok: true; exists: boolean }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${environment}/secrets/${secretName}`,
  );
  if (result.ok) {
    return { ok: true, exists: true };
  }
  if (result.error.status === 404) {
    return { ok: true, exists: false };
  }
  return { ok: false, error: mapGithubFailure(result.error, "get_environment_secret") };
}
