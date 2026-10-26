import { describe, expect, it } from "vitest";
import {
  assertMintPoliciesSafe,
  buildWorkerDeployTokenPolicies,
} from "../../src/cloudflare/deploy-token-policy.js";

describe("buildWorkerDeployTokenPolicies", () => {
  it("builds Worker Editor plus Workers Scripts Read without forbidden groups", () => {
    const policies = buildWorkerDeployTokenPolicies("acct-1", "my-worker", {
      workersEditor: { id: "ed", name: "Workers Editor" },
      workersScriptsRead: { id: "rd", name: "Workers Scripts Read" },
    });
    expect(policies).toHaveLength(2);
    assertMintPoliciesSafe(policies);
    expect(policies[0].permission_groups[0].name).toBe("Workers Editor");
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
