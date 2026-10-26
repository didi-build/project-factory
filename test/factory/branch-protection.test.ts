import { describe, expect, it } from "vitest";
import { protectionLooksCorrect } from "../../src/factory/branch-protection.js";
import { githubBranchProtectionApiBody } from "../project-factory/github-fixtures.js";

describe("protectionLooksCorrect", () => {
  it("accepts GitHub enabled-object shape", () => {
    expect(protectionLooksCorrect(githubBranchProtectionApiBody())).toBe(true);
  });
});
