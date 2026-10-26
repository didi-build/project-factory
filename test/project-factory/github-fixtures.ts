export function githubBranchNotProtectedBody() {
  return {
    message: "Branch not protected",
    documentation_url:
      "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
  };
}

export function githubBranchProtectionApiBody() {
  return {
    required_status_checks: { strict: false, checks: [{ context: "check" }] },
    required_pull_request_reviews: { required_approving_review_count: 0 },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}
