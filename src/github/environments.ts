import type { GitHubClient, GitHubError } from "./client.js";
import { mapGithubFailure } from "./github-errors.js";
import {
  GITHUB_ENV_PREVIEW,
  GITHUB_ENV_PRODUCTION,
} from "../factory/provision-constants.js";
import { GITHUB_API_LIST_MAX_PAGES } from "./pagination.js";
import { paginateGithubApiList } from "./paginate-list.js";

export type ProductionEnvironmentPutBody = {
  reviewers: { type: "User"; id: number }[];
  can_admins_bypass: false;
  deployment_branch_policy: {
    protected_branches: false;
    custom_branch_policies: true;
  };
};

export type DeploymentBranchPolicyItem = {
  name: string;
  type?: string;
};

/** Shape of GET /repos/{owner}/{repo}/environments/{environment_name} (GitHub REST). */
export type GithubEnvironmentGetResponse = {
  name?: string;
  can_admins_bypass?: boolean;
  deployment_branch_policy?: {
    protected_branches?: boolean;
    custom_branch_policies?: boolean;
  };
  protection_rules?: {
    id?: number;
    type?: string;
    reviewers?: {
      type?: string;
      id?: number;
      reviewer?: { id?: number; login?: string };
    }[];
  }[];
};

export type ProductionVerifyFailure =
  | "reviewer_missing"
  | "wrong_reviewer"
  | "branch_policy_disabled"
  | "branch_policy_not_main_only"
  | "branch_policy_wrong_type"
  | "admins_can_bypass";

export function buildProductionEnvironmentPutBody(
  reviewerUserId: number,
): ProductionEnvironmentPutBody {
  return {
    reviewers: [{ type: "User", id: reviewerUserId }],
    can_admins_bypass: false,
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
}

export function verifyProductionEnvironmentConfig(
  envData: GithubEnvironmentGetResponse,
  branchPolicies: DeploymentBranchPolicyItem[],
  expectedReviewerUserId: number,
): { ok: true } | { ok: false; reason: ProductionVerifyFailure } {
  const rules = envData.protection_rules ?? [];
  const reviewerRule = rules.find((r) => r.type === "required_reviewers");
  const reviewers = reviewerRule?.reviewers ?? [];
  const hasReviewer = reviewers.some((r) => {
    const id = r.id ?? r.reviewer?.id;
    return r.type === "User" && id === expectedReviewerUserId;
  });
  if (!reviewerRule || reviewers.length === 0) {
    return { ok: false, reason: "reviewer_missing" };
  }
  if (!hasReviewer) {
    return { ok: false, reason: "wrong_reviewer" };
  }

  if (envData.can_admins_bypass !== false) {
    return { ok: false, reason: "admins_can_bypass" };
  }

  const policy = envData.deployment_branch_policy;
  if (policy?.custom_branch_policies !== true || policy?.protected_branches !== false) {
    return { ok: false, reason: "branch_policy_disabled" };
  }

  if (branchPolicies.length !== 1) {
    return { ok: false, reason: "branch_policy_not_main_only" };
  }
  const only = branchPolicies[0];
  if (only.type !== "branch" || only.name !== "main") {
    return { ok: false, reason: "branch_policy_wrong_type" };
  }

  return { ok: true };
}

function verifyPermissionDeniedGet(
  repoFull: string,
  pathSuffix: string,
  status: number,
): { ok: false; error: ReturnType<typeof mapGithubFailure> } | null {
  if (status !== 403) {
    return null;
  }
  const path = `/repos/${repoFull}${pathSuffix}`;
  return {
    ok: false,
    error: {
      error: {
        code: "permission_denied",
        message: `GET ${path} returned 403`,
        step: "verify_production_environment",
        retryable: false,
      },
    },
  };
}

async function listDeploymentBranchPolicies(
  github: GitHubClient,
  repoFull: string,
  environment: string,
): Promise<
  | { ok: true; policies: DeploymentBranchPolicyItem[] }
  | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const policies: DeploymentBranchPolicyItem[] = [];
  for (let page = 1; page <= GITHUB_API_LIST_MAX_PAGES; page += 1) {
    const result = await github.request(
      "GET",
      `/repos/${repoFull}/environments/${environment}/deployment-branch-policies?per_page=100&page=${page}`,
    );
    if (!result.ok) {
      const denied = verifyPermissionDeniedGet(
        repoFull,
        `/environments/${environment}/deployment-branch-policies`,
        result.error.status,
      );
      if (denied) {
        return denied;
      }
      return {
        ok: false,
        error: mapGithubFailure(result.error, "verify_production_environment"),
      };
    }
    const chunk =
      result.data && typeof result.data === "object"
        ? ((result.data as { branch_policies?: DeploymentBranchPolicyItem[] })
            .branch_policies ??
          (result.data as { deployment_branch_policies?: DeploymentBranchPolicyItem[] })
            .deployment_branch_policies ??
          [])
        : [];
    policies.push(...chunk);
    if (chunk.length < 100) {
      return { ok: true, policies };
    }
    if (page === GITHUB_API_LIST_MAX_PAGES) {
      return {
        ok: false,
        error: mapGithubFailure(
          {
            status: 400,
            code: "unknown",
            message: "list page limit exceeded",
            retryable: false,
          },
          "verify_production_environment",
        ),
      };
    }
  }
  return { ok: true, policies };
}

export async function resolveGithubUserId(
  github: GitHubClient,
  login: string,
): Promise<
  { ok: true; id: number } | { ok: false; error: ReturnType<typeof mapGithubFailure> }
> {
  const result = await github.request("GET", `/users/${encodeURIComponent(login)}`);
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
          message: `GitHub user ${login} not found`,
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
    { name: "main", type: "branch" },
  );
  if (!branchPolicy.ok && branchPolicy.error.status !== 422) {
    return {
      ok: false,
      error: mapGithubFailure(branchPolicy.error, "environment_branch_policy"),
    };
  }

  return { ok: true, created: !existedBefore, putBody };
}

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
    const denied = verifyPermissionDeniedGet(
      repoFull,
      `/environments/${GITHUB_ENV_PRODUCTION}`,
      env.error.status,
    );
    if (denied) {
      return denied;
    }
    return {
      ok: false,
      error: mapGithubFailure(env.error, "verify_production_environment"),
    };
  }

  const branches = await listDeploymentBranchPolicies(
    github,
    repoFull,
    GITHUB_ENV_PRODUCTION,
  );
  if (!branches.ok) {
    return branches;
  }

  const verified = verifyProductionEnvironmentConfig(
    env.data as GithubEnvironmentGetResponse,
    branches.policies,
    reviewerUserId,
  );
  if (!verified.ok) {
    const messages: Record<ProductionVerifyFailure, string> = {
      reviewer_missing: "production environment missing required reviewer",
      wrong_reviewer: "production environment has wrong required reviewer",
      branch_policy_disabled:
        "production environment deployment branch policy is not enabled for custom branches",
      branch_policy_not_main_only:
        "production environment must allow exactly one deployment branch (main)",
      branch_policy_wrong_type:
        "production environment deployment branch policy must be type branch named main",
      admins_can_bypass: "production environment must set can_admins_bypass to false",
    };
    return {
      ok: false,
      error: {
        error: {
          code: "upstream_error",
          message: messages[verified.reason],
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
  const listed = await paginateGithubApiList(async (page) => {
    const result = await github.request(
      "GET",
      `/repos/${repoFull}/environments?per_page=100&page=${page}`,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const envs =
      result.data && typeof result.data === "object"
        ? ((result.data as { environments?: { name: string }[] }).environments ?? [])
        : [];
    return { ok: true, items: envs };
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
          "list_environments",
        ),
      };
    }
    const ghError = (listed as { error: GitHubError }).error;
    return {
      ok: false,
      error: mapGithubFailure(ghError, "list_environments"),
    };
  }
  return { ok: true, names: listed.items.map((e) => e.name).sort() };
}

export { GITHUB_ENV_PREVIEW, GITHUB_ENV_PRODUCTION };
