export type CfTokenResources = Record<string, string | Record<string, string>>;

export type CfTokenPolicy = {
  effect: "allow";
  resources: CfTokenResources;
  permission_groups: { id: string; name: string }[];
};

/** Cloudflare account API token permission group for a single Worker script. */
export const INDIVIDUAL_WORKERS_EDITOR_PERMISSION_NAME = "Individual Workers Editor";

export const INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID =
  "7e79ec33834341f28dd431ab73884400";

export const WORKERS_SCRIPTS_READ_PERMISSION_NAME = "Workers Scripts Read";

const SCRIPT_TAG_PATTERN = /^[a-f0-9]{32}$/i;

export function assertWorkerScriptTag(scriptTag: string): void {
  if (!SCRIPT_TAG_PATTERN.test(scriptTag)) {
    throw new Error(`worker script tag must be 32 hex characters, got ${scriptTag}`);
  }
}

/**
 * Nested per-script resources for Individual Workers Editor (account key wraps script tag).
 * @see https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/#account-api-token-account-resources
 */
export function workerScriptPolicyResources(
  accountId: string,
  scriptTag: string,
): CfTokenResources {
  assertWorkerScriptTag(scriptTag);
  const accountKey = `com.cloudflare.api.account.${accountId}`;
  const scriptKey = `com.cloudflare.edge.worker.script.${scriptTag}`;
  return {
    [accountKey]: {
      [scriptKey]: "*",
    },
  };
}

export function buildPreviewDeployTokenPolicies(
  accountId: string,
  scriptTag: string,
  individualWorkersEditor: { id: string; name: string },
): CfTokenPolicy[] {
  return [
    {
      effect: "allow",
      resources: workerScriptPolicyResources(accountId, scriptTag),
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
  scriptTag: string,
  permissionGroups: {
    individualWorkersEditor: { id: string; name: string };
    workersScriptsRead: { id: string; name: string };
  },
): CfTokenPolicy[] {
  const accountResource = `com.cloudflare.api.account.${accountId}`;
  return [
    {
      effect: "allow",
      resources: workerScriptPolicyResources(accountId, scriptTag),
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

const FORBIDDEN_MINT_PERMISSION_NAMES = [
  "API Tokens",
  "D1",
  "R2",
  "Account API Tokens",
] as const;

export function assertIndividualWorkersEditorPermissionGroup(group: {
  id: string;
  name: string;
  scopes: string[];
}): void {
  if (group.id !== INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID) {
    throw new Error(
      `expected permission group id ${INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID}, got ${group.id}`,
    );
  }
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
