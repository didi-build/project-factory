import type { FactoryStep } from "../tools/types.js";

export type AuditInput = {
  request_id: string;
  caller: string;
  tool: string;
  dry_run: boolean;
  input: Record<string, string | boolean | undefined>;
  approval_ref?: string;
  status: string;
  resources?: Record<string, string | undefined>;
  duration_ms: number;
  github_installation_token_minted?: boolean;
  github_installation_token_permissions?: Record<string, string>;
  steps?: FactoryStep[];
  failed_step?: string;
};

export function writeAuditEntry(entry: AuditInput): void {
  console.log(
    JSON.stringify({
      event: "factory_call",
      ...entry,
    }),
  );
}

export type TokenMintAuditInput = {
  request_id: string;
  token_name: string;
  token_id: string;
};

export function writeTokenMintAudit(entry: TokenMintAuditInput): void {
  console.log(
    JSON.stringify({
      event: "token_mint",
      ...entry,
    }),
  );
}

export type TokenRevokeAuditInput = {
  request_id: string;
  token_name: string;
  token_id: string;
  reason: string;
};

export function writeTokenRevokeAudit(entry: TokenRevokeAuditInput): void {
  console.log(
    JSON.stringify({
      event: "token_revoke",
      ...entry,
    }),
  );
}

export type TokenRevokeFailedAuditInput = {
  request_id: string;
  token_id: string;
  reason: string;
};

export function writeTokenRevokeFailedAudit(entry: TokenRevokeFailedAuditInput): void {
  console.log(
    JSON.stringify({
      event: "token_revoke_failed",
      ...entry,
    }),
  );
}
