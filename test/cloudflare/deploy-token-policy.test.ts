import { describe, expect, it } from "vitest";
import {
  assertMintPoliciesSafe,
  buildPreviewDeployTokenPolicies,
  buildProductionDeployTokenPolicies,
  workerScriptResourceKey,
} from "../../src/cloudflare/deploy-token-policy.js";

describe("workerScriptResourceKey", () => {
  it("uses com.cloudflare.edge.worker.script account and script segments", () => {
    expect(workerScriptResourceKey("acct-1", "my-worker")).toBe(
      "com.cloudflare.edge.worker.script.acct-1.my-worker",
    );
  });
});

describe("buildPreviewDeployTokenPolicies", () => {
  it("scopes Individual Workers Editor to the preview script only", () => {
    const policies = buildPreviewDeployTokenPolicies("acct-1", "my-worker-preview", {
      id: "ed",
      name: "Individual Workers Editor",
    });
    expect(policies).toHaveLength(1);
    assertMintPoliciesSafe(policies);
    expect(policies[0].permission_groups[0].name).toBe("Individual Workers Editor");
  });
});

describe("buildProductionDeployTokenPolicies", () => {
  it("adds Workers Scripts Read at account scope", () => {
    const policies = buildProductionDeployTokenPolicies("acct-1", "my-worker", {
      individualWorkersEditor: { id: "ed", name: "Individual Workers Editor" },
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
