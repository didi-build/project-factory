/** Literal expected API bodies (not imported from production constants). */

export const EXPECTED_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
};

export const EXPECTED_WRITE_INSTALLATION_TOKEN_PERMISSIONS = {
  administration: "write",
  contents: "read",
  issues: "write",
  metadata: "read",
};

export const EXPECTED_BRANCH_PROTECTION_PUT_BODY = {
  required_status_checks: {
    strict: false,
    checks: [{ context: "check" }],
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 0,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};

export const EXPECTED_FACTORY_LABEL_POST_BODIES = [
  {
    name: "privileged-change",
    color: "B60205",
    description: "PR touches privileged deploy or workflow paths (review required)",
  },
  {
    name: "privileged-change-reviewed",
    color: "0E8A16",
    description: "Maintainer reviewed privileged-change warning",
  },
  {
    name: "delegatable",
    color: "5319E7",
    description: "Work that agents may take without privileged maintainer review",
  },
  {
    name: "launchpad-dependabot-automerge",
    color: "1D76DB",
    description: "Dependabot minor/patch PR eligible for auto-merge when CI is green",
  },
];
