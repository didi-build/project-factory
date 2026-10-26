/** Literal expected API bodies for provision_cloudflare (not imported from production constants). */

export const EXPECTED_PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "read",
  environments: "read",
};

export const EXPECTED_PROVISION_WRITE_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "write",
  environments: "write",
};

export const EXPECTED_PRODUCTION_ENVIRONMENT_PUT_BODY = {
  reviewers: [{ type: "User", id: 4242 }],
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
};

export const EXPECTED_PRODUCTION_DEPLOYMENT_BRANCH_POLICY_BODY = {
  name: "main",
};

export const EXPECTED_CF_PRODUCTION_TOKEN_POLICIES = [
  {
    effect: "allow",
    resources: {
      "com.cloudflare.api.account.cf-account-1.worker.script.demo-app": "*",
    },
    permission_groups: [{ id: "pg-workers-editor", name: "Workers Editor" }],
  },
  {
    effect: "allow",
    resources: {
      "com.cloudflare.api.account.cf-account-1": "*",
    },
    permission_groups: [
      { id: "pg-workers-scripts-read", name: "Workers Scripts Read" },
    ],
  },
];

export const EXPECTED_CF_PREVIEW_TOKEN_POLICIES = [
  {
    effect: "allow",
    resources: {
      "com.cloudflare.api.account.cf-account-1.worker.script.demo-app-preview": "*",
    },
    permission_groups: [{ id: "pg-workers-editor", name: "Workers Editor" }],
  },
  {
    effect: "allow",
    resources: {
      "com.cloudflare.api.account.cf-account-1": "*",
    },
    permission_groups: [
      { id: "pg-workers-scripts-read", name: "Workers Scripts Read" },
    ],
  },
];
