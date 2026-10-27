export type CfTokenPolicy = {
  effect: "allow";
  resources: Record<string, string>;
  permission_groups: { id: string; name: string }[];
};

/** Cloudflare account API token permission group for a single Worker script. */
export const INDIVIDUAL_WORKERS_EDITOR_PERMISSION_NAME = "Individual Workers Editor";

export const WORKERS_SCRIPTS_READ_PERMISSION_NAME = "Workers Scripts Read";

/**
 * Per-Worker script resource key for account API token policies.
 * @see https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/#account-api-token-account-resources
 * @see https://developers.cloudflare.com/r2/api/tokens/#resources (com.cloudflare.edge.* pattern)
 */
export function workerScriptResourceKey(accountId: string, workerName: string): string {
  return `com.cloudflare.edge.worker.script.${accountId}.${workerName}`;
}

export function buildPreviewDeployTokenPolicies(
  accountId: string,
  workerName: string,
  individualWorkersEditor: { id: string; name: string },
): CfTokenPolicy[] {
  const workerResource = workerScriptResourceKey(accountId, workerName);
  return [
    {
      effect: "allow",
      resources: { [workerResource]: "*" },
      permission_groups: [
        {
          id: individualWorkersEditor.id,
          name: individualWorkersEditor.name,
        },
      ],
    },
  ];
}

export function buildProductionDeployTokenPolicies(
  accountId: string,
  workerName: string,
  permissionGroups: {
    individualWorkersEditor: { id: string; name: string };
    workersScriptsRead: { id: string; name: string };
  },
): CfTokenPolicy[] {
  const workerResource = workerScriptResourceKey(accountId, workerName);
  const accountResource = `com.cloudflare.api.account.${accountId}`;
  return [
    {
      effect: "allow",
      resources: { [workerResource]: "*" },
      permission_groups: [
        {
          id: permissionGroups.individualWorkersEditor.id,
          name: permissionGroups.individualWorkersEditor.name,
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

/** @deprecated Use buildPreviewDeployTokenPolicies / buildProductionDeployTokenPolicies */
export function buildWorkerDeployTokenPolicies(
  accountId: string,
  workerName: string,
  permissionGroups: {
    workersEditor: { id: string; name: string };
    workersScriptsRead: { id: string; name: string };
  },
): CfTokenPolicy[] {
  return buildProductionDeployTokenPolicies(accountId, workerName, {
    individualWorkersEditor: permissionGroups.workersEditor,
    workersScriptsRead: permissionGroups.workersScriptsRead,
  });
}

const FORBIDDEN_MINT_PERMISSION_NAMES = [
  "API Tokens",
  "D1",
  "R2",
  "Account API Tokens",
] as const;

export function assertIndividualWorkersEditorPermissionGroup(group: {
  name: string;
  scopes: string[];
}): void {
  if (group.name !== INDIVIDUAL_WORKERS_EDITOR_PERMISSION_NAME) {
    throw new Error(
      `expected permission group ${INDIVIDUAL_WORKERS_EDITOR_PERMISSION_NAME}, got ${group.name}`,
    );
  }
  const coversWorker = group.scopes.some((scope) => /worker/i.test(scope));
  if (!coversWorker) {
    throw new Error(
      `${INDIVIDUAL_WORKERS_EDITOR_PERMISSION_NAME} scopes do not cover Workers`,
    );
  }
}

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
