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

export const EXPECTED_CF_TOKEN_POLICY = {
  effect: "allow",
  resources: {
    "com.cloudflare.api.account.cf-account-1.worker.script.demo-app": "*",
  },
  permission_groups: [{ id: "pg-workers-edit", name: "Workers Scripts Edit" }],
};

export const EXPECTED_CF_PREVIEW_TOKEN_POLICY = {
  effect: "allow",
  resources: {
    "com.cloudflare.api.account.cf-account-1.worker.script.demo-app-preview": "*",
  },
  permission_groups: [{ id: "pg-workers-edit", name: "Workers Scripts Edit" }],
};
