import { describe, expect, it } from "vitest";
import {
  verifyProductionEnvironmentConfig,
  type GithubEnvironmentGetResponse,
} from "../../src/github/environments.js";

const REVIEWER_ID = 4242;

function envFixture(
  overrides?: Partial<GithubEnvironmentGetResponse>,
): GithubEnvironmentGetResponse {
  return {
    name: "production",
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
    protection_rules: [
      {
        id: 1,
        type: "required_reviewers",
        reviewers: [
          {
            type: "User",
            reviewer: { id: REVIEWER_ID, login: "diademshoukralla" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("verifyProductionEnvironmentConfig", () => {
  it("accepts required_reviewers and main branch policy", () => {
    const result = verifyProductionEnvironmentConfig(
      envFixture(),
      [{ name: "main", type: "branch" }],
      REVIEWER_ID,
    );
    expect(result).toEqual({ ok: true });
  });

  it("fails when required reviewer is missing", () => {
    const result = verifyProductionEnvironmentConfig(
      envFixture({ protection_rules: [] }),
      [{ name: "main", type: "branch" }],
      REVIEWER_ID,
    );
    expect(result).toEqual({ ok: false, reason: "reviewer_missing" });
  });

  it("fails when reviewer id does not match", () => {
    const result = verifyProductionEnvironmentConfig(
      envFixture(),
      [{ name: "main", type: "branch" }],
      9999,
    );
    expect(result).toEqual({ ok: false, reason: "wrong_reviewer" });
  });

  it("fails when custom branch policies are disabled", () => {
    const result = verifyProductionEnvironmentConfig(
      envFixture({
        deployment_branch_policy: {
          protected_branches: true,
          custom_branch_policies: false,
        },
      }),
      [{ name: "main", type: "branch" }],
      REVIEWER_ID,
    );
    expect(result).toEqual({ ok: false, reason: "branch_policy_disabled" });
  });

  it("fails when branch policy is not main-only", () => {
    const result = verifyProductionEnvironmentConfig(envFixture(), [], REVIEWER_ID);
    expect(result).toEqual({ ok: false, reason: "branch_policy_not_main_only" });
  });

  it("fails when deployment rule is a tag named main", () => {
    const result = verifyProductionEnvironmentConfig(
      envFixture(),
      [{ name: "main", type: "tag" }],
      REVIEWER_ID,
    );
    expect(result).toEqual({ ok: false, reason: "branch_policy_wrong_type" });
  });
});
