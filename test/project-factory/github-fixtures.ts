export function githubBranchProtectionApiBody() {
  return {
    required_status_checks: { strict: false, checks: [{ context: "check" }] },
    required_pull_request_reviews: { required_approving_review_count: 0 },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}
