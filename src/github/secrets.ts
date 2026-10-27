import type { GitHubClient } from "./client.js";
import { mapGithubFailure } from "./github-errors.js";
import { sealGitHubSecret } from "./github-secret-seal.js";
import { paginateGithubApiList } from "./paginate-list.js";

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
  const listed = await paginateGithubApiList(async (page) => {
    const result = await github.request(
      "GET",
      `/repos/${repoFull}/actions/secrets?per_page=100&page=${page}`,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const secrets =
      result.data && typeof result.data === "object"
        ? ((result.data as { secrets?: { name: string }[] }).secrets ?? [])
        : [];
    return { ok: true, items: secrets };
  }, 100);
  if (!listed.ok) {
    if ("pageLimitExceeded" in listed && listed.pageLimitExceeded) {
      return {
        ok: false,
        error: mapGithubFailure(
          {
            status: 400,
            code: "unknown",
            message: "list page limit exceeded",
            retryable: false,
          },
          "list_repo_secrets",
        ),
      };
    }
    const ghError = (
      listed as { error: { status: number; code?: string; message: string } }
    ).error;
    return {
      ok: false,
      error: mapGithubFailure({ ...ghError, retryable: false }, "list_repo_secrets"),
    };
  }
  return { ok: true, names: listed.items.map((s) => s.name).sort() };
}

export async function listEnvironmentSecretNames(
  github: GitHubClient,
  repoFull: string,
  environment: string,
): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const listed = await paginateGithubApiList(async (page) => {
    const result = await github.request(
      "GET",
      `/repos/${repoFull}/environments/${environment}/secrets?per_page=100&page=${page}`,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const secrets =
      result.data && typeof result.data === "object"
        ? ((result.data as { secrets?: { name: string }[] }).secrets ?? [])
        : [];
    return { ok: true, items: secrets };
  }, 100);
  if (!listed.ok) {
    if ("pageLimitExceeded" in listed && listed.pageLimitExceeded) {
      return {
        ok: false,
        error: mapGithubFailure(
          {
            status: 400,
            code: "unknown",
            message: "list page limit exceeded",
            retryable: false,
          },
          "list_environment_secrets",
        ),
      };
    }
    const ghError = (
      listed as { error: { status: number; code?: string; message: string } }
    ).error;
    return {
      ok: false,
      error: mapGithubFailure(
        { ...ghError, retryable: false },
        "list_environment_secrets",
      ),
    };
  }
  return { ok: true, names: listed.items.map((s) => s.name).sort() };
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
