import { describe, expect, it } from "vitest";
import {
  PRIVILEGED_CHANGE_MARKER,
  buildPrivilegedChangeCommentBody,
} from "../scripts/privileged-change-comment-body.mjs";

describe("privileged-change-comment-body (unit)", () => {
  it("cleared state: marker first, idempotent body", () => {
    const body = buildPrivilegedChangeCommentBody({
      flagged: false,
      privilegedFiles: [],
      findings: [],
      workflowDetails: {},
    });
    expect(body.split("\n")[0]).toBe(PRIVILEGED_CHANGE_MARKER);
    expect(body).toContain("Privileged change cleared");
    expect(
      buildPrivilegedChangeCommentBody({
        flagged: false,
        privilegedFiles: [],
        findings: [],
        workflowDetails: {},
      }),
    ).toBe(body);
  });

  it("flagged state: marker first, high severity before files, snapshot", () => {
    const body = buildPrivilegedChangeCommentBody({
      flagged: true,
      privilegedFiles: [".github/workflows/evil.yml"],
      findings: [
        {
          severity: "high",
          message: ".github/workflows/evil.yml: environment reference: migrate-nonprod",
        },
        {
          severity: "high",
          message: "New workflow file: .github/workflows/evil.yml",
        },
      ],
      workflowDetails: {
        ".github/workflows/evil.yml": {
          environments: ["migrate-nonprod"],
          secrets: [],
          triggers: ["workflow_dispatch"],
          permissionKeys: ["contents"],
          usesOwners: ["actions"],
        },
      },
    });

    expect(body.split("\n")[0]).toBe(PRIVILEGED_CHANGE_MARKER);
    const highIndex = body.indexOf("### High severity");
    const filesIndex = body.indexOf("### Changed privileged files");
    expect(highIndex).toBeGreaterThan(-1);
    expect(filesIndex).toBeGreaterThan(highIndex);
    expect(body).toMatchSnapshot();
  });

  it("includes stale review notice when requested on flagged PRs", () => {
    const body = buildPrivilegedChangeCommentBody(
      {
        flagged: true,
        privilegedFiles: ["wrangler.jsonc"],
        findings: [],
        workflowDetails: {},
      },
      { staleReviewNotice: true },
    );
    expect(body).toContain("privileged-change-reviewed");
    expect(body).toContain("re-review");
  });
});
