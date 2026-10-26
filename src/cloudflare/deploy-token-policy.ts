export type CfTokenPolicy = {
  effect: "allow";
  resources: Record<string, string>;
  permission_groups: { id: string; name: string }[];
};

export function buildWorkerDeployTokenPolicies(
  accountId: string,
  workerName: string,
  permissionGroups: {
    workersEditor: { id: string; name: string };
    workersScriptsRead: { id: string; name: string };
  },
): CfTokenPolicy[] {
  const workerResource = `com.cloudflare.api.account.${accountId}.worker.script.${workerName}`;
  const accountResource = `com.cloudflare.api.account.${accountId}`;
  return [
    {
      effect: "allow",
      resources: { [workerResource]: "*" },
      permission_groups: [
        {
          id: permissionGroups.workersEditor.id,
          name: permissionGroups.workersEditor.name,
        },
      ],
    },
    {
      effect: "allow",
      resources: { [accountResource]: "*" },
      permission_groups: [
        {
          id: permissionGroups.workersScriptsRead.id,
          name: permissionGroups.workersScriptsRead.name,
        },
      ],
    },
  ];
}

const FORBIDDEN_MINT_PERMISSION_NAMES = [
  "API Tokens",
  "D1",
  "R2",
  "Account API Tokens",
] as const;

export function assertMintPoliciesSafe(policies: CfTokenPolicy[]): void {
  for (const policy of policies) {
    for (const group of policy.permission_groups) {
      const name = group.name;
      for (const forbidden of FORBIDDEN_MINT_PERMISSION_NAMES) {
        if (name.includes(forbidden)) {
          throw new Error(`forbidden permission in mint policy: ${name}`);
        }
      }
    }
  }
}
