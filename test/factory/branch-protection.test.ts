import { describe, expect, it } from "vitest";
import {
  branchProtectionReportedOk,
  protectionLooksCorrect,
} from "../../src/factory/branch-protection.js";
import { githubBranchProtectionApiBody } from "../project-factory/github-fixtures.js";

describe("protectionLooksCorrect", () => {
  it("accepts GitHub enabled-object shape", () => {
    expect(protectionLooksCorrect(githubBranchProtectionApiBody())).toBe(true);
  });
});

describe("branchProtectionReportedOk", () => {
  it("is true only for an explicit true (fail closed on null and false)", () => {
    expect(branchProtectionReportedOk(true)).toBe(true);
    expect(branchProtectionReportedOk(false)).toBe(false);
    expect(branchProtectionReportedOk(null)).toBe(false);
  });
});
