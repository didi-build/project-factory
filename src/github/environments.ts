import type { GitHubClient } from "./client.js";
import { mapGithubFailure } from "./github-errors.js";
import {
  GITHUB_ENV_PREVIEW,
  GITHUB_ENV_PRODUCTION,
} from "../factory/provision-constants.js";

export async function resolveGithubUserId(
  github: GitHubClient,
  login: string,
): Promise<
  { ok: true; id: number } | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request("GET", `/users/${login}`);
  if (!result.ok) {
    return { ok: false, error: mapGithubFailure(result.error, "resolve_reviewer") };
  }
  const id = (result.data as { id?: number }).id;
  if (!id) {
    return {
      ok: false,
      error: {
        error: {
          code: "upstream_error",
          message: "404 unknown",
          step: "resolve_reviewer",
          retryable: false,
        },
      },
    };
  }
  return { ok: true, id };
}

export async function ensureGithubEnvironment(
  github: GitHubClient,
  repoFull: string,
  environmentName: string,
  options: {
    productionReviewerId?: number;
  },
): Promise<
  | { ok: true; created: boolean }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const existing = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${environmentName}`,
  );
  if (existing.ok) {
    return { ok: true, created: false };
  }
  if (existing.error.status !== 404) {
    return { ok: false, error: mapGithubFailure(existing.error, "get_environment") };
  }

  const body: Record<string, unknown> = {};
  if (environmentName === GITHUB_ENV_PRODUCTION && options.productionReviewerId) {
    body.reviewers = [{ type: "User", id: options.productionReviewerId }];
    body.deployment_branch_policy = {
      protected_branches: false,
      custom_branch_policies: true,
    };
  }

  const put = await github.request(
    "PUT",
    `/repos/${repoFull}/environments/${environmentName}`,
    body,
  );
  if (!put.ok) {
    return { ok: false, error: mapGithubFailure(put.error, "put_environment") };
  }

  if (environmentName === GITHUB_ENV_PRODUCTION) {
    const branchPolicy = await github.request(
      "POST",
      `/repos/${repoFull}/environments/${environmentName}/deployment-branch-policies`,
      { name: "main" },
    );
    if (!branchPolicy.ok && branchPolicy.error.status !== 422) {
      return {
        ok: false,
        error: mapGithubFailure(branchPolicy.error, "environment_branch_policy"),
      };
    }
  }

  return { ok: true, created: true };
}

export async function listEnvironmentNames(
  github: GitHubClient,
  repoFull: string,
): Promise<
  | { ok: true; names: string[] }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request("GET", `/repos/${repoFull}/environments`);
  if (!result.ok) {
    return { ok: false, error: mapGithubFailure(result.error, "list_environments") };
  }
  const envs =
    result.data && typeof result.data === "object"
      ? ((result.data as { environments?: { name: string }[] }).environments ?? [])
      : [];
  return { ok: true, names: envs.map((e) => e.name).sort() };
}

export { GITHUB_ENV_PREVIEW, GITHUB_ENV_PRODUCTION };
