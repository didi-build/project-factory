/** Literal expected API bodies for provision_cloudflare (not imported from production constants). */

export const EXPECTED_PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "read",
  environments: "read",
};

export const EXPECTED_PROVISION_WRITE_INSTALLATION_TOKEN_PERMISSIONS = {
  administration: "write",
  environments: "write",
  secrets: "write",
  metadata: "read",
};

export const EXPECTED_PRODUCTION_ENVIRONMENT_PUT_BODY = {
  reviewers: [{ type: "User", id: 4242 }],
  can_admins_bypass: false,
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
};

export const EXPECTED_PRODUCTION_DEPLOYMENT_BRANCH_POLICY_BODY = {
  name: "main",
  type: "branch",
};

const CF_ACCOUNT = "cf-account-1";
export const EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const CF_EDITOR_ID = "7e79ec33834341f28dd431ab73884400";
const CF_READ_ID = "pg-workers-scripts-read";

export const EXPECTED_CF_PREVIEW_TOKEN_POST_BODY = {
  name: "project-factory-demo-app-deploy-preview",
  policies: [
    {
      effect: "allow",
      resources: {
        [`com.cloudflare.api.account.${CF_ACCOUNT}`]: {
          [`com.cloudflare.edge.worker.script.${EXPECTED_DEMO_APP_PREVIEW_SCRIPT_TAG}`]:
            "*",
        },
      },
      permission_groups: [{ id: CF_EDITOR_ID, name: "Individual Workers Editor" }],
    },
  ],
};

export const EXPECTED_CF_PRODUCTION_TOKEN_POST_BODY = {
  name: "project-factory-demo-app-deploy-production",
  policies: [
    {
      effect: "allow",
      resources: {
        [`com.cloudflare.api.account.${CF_ACCOUNT}`]: {
          [`com.cloudflare.edge.worker.script.${EXPECTED_DEMO_APP_PRODUCTION_SCRIPT_TAG}`]:
            "*",
        },
      },
      permission_groups: [{ id: CF_EDITOR_ID, name: "Individual Workers Editor" }],
    },
    {
      effect: "allow",
      resources: {
        [`com.cloudflare.api.account.${CF_ACCOUNT}`]: "*",
      },
      permission_groups: [{ id: CF_READ_ID, name: "Workers Scripts Read" }],
    },
  ],
};
