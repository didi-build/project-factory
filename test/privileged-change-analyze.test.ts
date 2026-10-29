import { describe, expect, it } from "vitest";
import {
  analyzePrivilegedChange,
  privilegedChangeCheckState,
} from "../scripts/lib/privileged-change-analyze.mjs";

describe("privileged-change-analyze (unit)", () => {
  it("flags privileged wrangler config without workflow findings", () => {
    const result = analyzePrivilegedChange(
      [{ filename: "wrangler.jsonc", status: "modified" }],
      {},
      { trustedOrg: "didi-build" },
    );
    expect(result.flagged).toBe(true);
    expect(result.privilegedFiles).toEqual(["wrangler.jsonc"]);
    expect(result.findings).toEqual([]);
  });

  it("marks new workflow and migrate-nonprod as high severity", () => {
    const workflow = `name: X
on:
  workflow_dispatch:
jobs:
  j:
    runs-on: ubuntu-latest
    environment: migrate-nonprod
    steps:
      - run: echo ok
`;
    const result = analyzePrivilegedChange(
      [
        {
          filename: ".github/workflows/migrate.yml",
          status: "added",
        },
      ],
      { ".github/workflows/migrate.yml": workflow },
      { trustedOrg: "didi-build" },
    );
    expect(result.flagged).toBe(true);
    expect(result.findings.some((f) => f.message.includes("New workflow"))).toBe(true);
    expect(result.findings.some((f) => f.message.includes("migrate-nonprod"))).toBe(
      true,
    );
  });

  it("flags infrastructure edits to privileged pull-files parser", () => {
    const result = analyzePrivilegedChange(
      [{ filename: "scripts/lib/privileged-pull-files-api.mjs", status: "modified" }],
      {},
      { trustedOrg: "didi-build" },
    );
    expect(result.flagged).toBe(true);
    expect(
      result.findings.some((f) =>
        f.message.includes("Changes privileged-change flag infrastructure"),
      ),
    ).toBe(true);
    expect(
      result.findings.some((f) => f.message.includes("privileged-pull-files-api.mjs")),
    ).toBe(true);
  });

  it("check state succeeds when reviewed label present", () => {
    expect(privilegedChangeCheckState(true, [])).toBe("failure");
    expect(privilegedChangeCheckState(true, ["privileged-change-reviewed"])).toBe(
      "success",
    );
    expect(privilegedChangeCheckState(false, [])).toBe("success");
  });
});
