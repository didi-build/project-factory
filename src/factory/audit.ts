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
};

export function writeAuditEntry(entry: AuditInput): void {
  console.log(
    JSON.stringify({
      event: "factory_call",
      ...entry,
    }),
  );
}
