import { describe, expect, it } from "vitest";
import {
  assertMintPoliciesSafe,
  buildPreviewDeployTokenPolicies,
  buildProductionDeployTokenPolicies,
  INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
  workerScriptPolicyResources,
} from "../../src/cloudflare/deploy-token-policy.js";

const SCRIPT_TAG = "cafebabecafebabecafebabecafebabe";

describe("workerScriptPolicyResources", () => {
  it("nests script tag under com.cloudflare.api.account", () => {
    expect(workerScriptPolicyResources("acct-1", SCRIPT_TAG)).toEqual({
      "com.cloudflare.api.account.acct-1": {
        [`com.cloudflare.edge.worker.script.${SCRIPT_TAG}`]: "*",
      },
    });
  });
});

describe("buildPreviewDeployTokenPolicies", () => {
  it("scopes Individual Workers Editor to the preview script tag only", () => {
    const policies = buildPreviewDeployTokenPolicies("acct-1", SCRIPT_TAG, {
      id: INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
      name: "Individual Workers Editor",
    });
    expect(policies).toHaveLength(1);
    assertMintPoliciesSafe(policies);
    expect(policies[0].permission_groups[0].id).toBe(
      INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
    );
  });
});

describe("buildProductionDeployTokenPolicies", () => {
  it("adds Workers Scripts Read at account scope", () => {
    const policies = buildProductionDeployTokenPolicies("acct-1", SCRIPT_TAG, {
      individualWorkersEditor: {
        id: INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
        name: "Individual Workers Editor",
      },
      workersScriptsRead: { id: "rd", name: "Workers Scripts Read" },
    });
    expect(policies).toHaveLength(2);
    assertMintPoliciesSafe(policies);
    expect(policies[1].permission_groups[0].name).toBe("Workers Scripts Read");
  });

  it("rejects policies that include API Tokens or D1 or R2 permissions", () => {
    expect(() =>
      assertMintPoliciesSafe([
        {
          effect: "allow",
          resources: { "com.cloudflare.api.account.x": "*" },
          permission_groups: [{ id: "1", name: "Account API Tokens Edit" }],
        },
      ]),
    ).toThrow(/forbidden permission/);
  });
});
