import type { GitHubClient } from "./client.js";
import { mapGithubFailure } from "./github-errors.js";
import {
  GITHUB_ENV_PREVIEW,
  GITHUB_ENV_PRODUCTION,
} from "../factory/provision-constants.js";

export type ProductionEnvironmentPutBody = {
  reviewers: { type: "User"; id: number }[];
  deployment_branch_policy: {
    protected_branches: false;
    custom_branch_policies: true;
  };
};

export function buildProductionEnvironmentPutBody(
  reviewerUserId: number,
): ProductionEnvironmentPutBody {
  return {
    reviewers: [{ type: "User", id: reviewerUserId }],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
}

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

export async function ensurePreviewGithubEnvironment(
  github: GitHubClient,
  repoFull: string,
): Promise<
  | { ok: true; created: boolean }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const existing = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PREVIEW}`,
  );
  if (existing.ok) {
    return { ok: true, created: false };
  }
  if (existing.error.status !== 404) {
    return { ok: false, error: mapGithubFailure(existing.error, "get_environment") };
  }
  const put = await github.request(
    "PUT",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PREVIEW}`,
    {},
  );
  if (!put.ok) {
    return { ok: false, error: mapGithubFailure(put.error, "put_environment") };
  }
  return { ok: true, created: true };
}

export async function ensureProductionGithubEnvironment(
  github: GitHubClient,
  repoFull: string,
  reviewerUserId: number,
): Promise<
  | { ok: true; created: boolean; putBody: ProductionEnvironmentPutBody }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const putBody = buildProductionEnvironmentPutBody(reviewerUserId);
  const existing = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}`,
  );
  const existedBefore = existing.ok;
  if (!existing.ok && existing.error.status !== 404) {
    return { ok: false, error: mapGithubFailure(existing.error, "get_environment") };
  }

  const put = await github.request(
    "PUT",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}`,
    putBody,
  );
  if (!put.ok) {
    return { ok: false, error: mapGithubFailure(put.error, "put_environment") };
  }

  const branchPolicy = await github.request(
    "POST",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}/deployment-branch-policies`,
    { name: "main" },
  );
  if (!branchPolicy.ok && branchPolicy.error.status !== 422) {
    return {
      ok: false,
      error: mapGithubFailure(branchPolicy.error, "environment_branch_policy"),
    };
  }

  return { ok: true, created: !existedBefore, putBody };
}

type GithubEnvironmentPayload = {
  reviewers?: {
    type?: string;
    id?: number;
    reviewer?: { id?: number; login?: string };
  }[];
  deployment_branch_policy?: {
    protected_branches?: boolean;
    custom_branch_policies?: boolean;
  };
};

export async function verifyProductionGithubEnvironment(
  github: GitHubClient,
  repoFull: string,
  reviewerUserId: number,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof mapGithubFailure> }> {
  const env = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}`,
  );
  if (!env.ok) {
    return {
      ok: false,
      error: mapGithubFailure(env.error, "verify_production_environment"),
    };
  }
  const data = env.data as GithubEnvironmentPayload;
  const reviewers = data.reviewers ?? [];
  const hasReviewer = reviewers.some((r) => {
    const id = r.id ?? r.reviewer?.id;
    return r.type === "User" && id === reviewerUserId;
  });
  const policy = data.deployment_branch_policy;
  const policyOk =
    policy?.custom_branch_policies === true && policy?.protected_branches === false;

  const branches = await github.request(
    "GET",
    `/repos/${repoFull}/environments/${GITHUB_ENV_PRODUCTION}/deployment-branch-policies`,
  );
  if (!branches.ok) {
    return {
      ok: false,
      error: mapGithubFailure(branches.error, "verify_production_environment"),
    };
  }
  const branchNames =
    branches.data && typeof branches.data === "object"
      ? (
          (branches.data as { branch_policies?: { name: string }[] }).branch_policies ??
          (branches.data as { deployment_branch_policies?: { name: string }[] })
            .deployment_branch_policies ??
          []
        ).map((b) => b.name)
      : [];
  const mainOnly = branchNames.length === 1 && branchNames[0] === "main";

  if (!hasReviewer || !policyOk || !mainOnly) {
    return {
      ok: false,
      error: {
        error: {
          code: "upstream_error",
          message:
            "production environment missing required reviewer, branch policy, or main-only deployment rule",
          step: "verify_production_environment",
          retryable: false,
        },
      },
    };
  }
  return { ok: true };
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
