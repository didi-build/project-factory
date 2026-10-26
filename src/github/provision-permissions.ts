/** Installation token permissions for provision_cloudflare (ADR epic table + Environments). */

export const PROVISION_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "write",
  environments: "write",
} as const;

export const PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "read",
  environments: "read",
} as const;
