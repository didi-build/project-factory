/** Installation token permissions for provision_cloudflare write path (ADR epic table). */

export const PROVISION_INSTALLATION_TOKEN_PERMISSIONS = {
  administration: "write",
  environments: "write",
  secrets: "write",
  metadata: "read",
} as const;

/** Read-only installation token for provision_cloudflare dry_run. */

export const PROVISION_DRY_RUN_INSTALLATION_TOKEN_PERMISSIONS = {
  metadata: "read",
  administration: "read",
  secrets: "read",
  environments: "read",
} as const;
