import { describe, expect, it } from "vitest";
import {
  assertIndividualWorkersEditorPermissionGroup,
  buildPreviewDeployTokenPolicies,
  INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
  workerScriptPolicyResources,
} from "../../src/cloudflare/deploy-token-policy.js";

const SCRIPT_TAG = "cafebabecafebabecafebabecafebabe";

describe("mint policy guards", () => {
  it("requires nested script tag resources under account key", () => {
    const resources = workerScriptPolicyResources("acct-1", SCRIPT_TAG);
    expect(resources).toEqual({
      "com.cloudflare.api.account.acct-1": {
        [`com.cloudflare.edge.worker.script.${SCRIPT_TAG}`]: "*",
      },
    });
    expect(resources).not.toHaveProperty(
      `com.cloudflare.edge.worker.script.acct-1.demo`,
    );
  });

  it("pins Individual Workers Editor permission group id in mint policies", () => {
    const policies = buildPreviewDeployTokenPolicies("acct-1", SCRIPT_TAG, {
      id: INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
      name: "Individual Workers Editor",
    });
    expect(policies[0].permission_groups[0].id).toBe(
      "7e79ec33834341f28dd431ab73884400",
    );
  });

  it("rejects wrong Individual Workers Editor permission group id", () => {
    expect(() =>
      assertIndividualWorkersEditorPermissionGroup({
        id: "wrong-id",
        name: "Individual Workers Editor",
        scopes: ["com.cloudflare.api.account.workers"],
      }),
    ).toThrow(INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID);
  });

  it("rejects wrong Individual Workers Editor permission group name", () => {
    expect(() =>
      assertIndividualWorkersEditorPermissionGroup({
        id: INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
        name: "Workers Scripts Read",
        scopes: ["com.cloudflare.api.account.workers"],
      }),
    ).toThrow(/Individual Workers Editor/);
  });

  it("rejects editor group without worker scopes", () => {
    expect(() =>
      assertIndividualWorkersEditorPermissionGroup({
        id: INDIVIDUAL_WORKERS_EDITOR_PERMISSION_ID,
        name: "Individual Workers Editor",
        scopes: ["account"],
      }),
    ).toThrow(/scopes do not cover Workers/);
  });
});
