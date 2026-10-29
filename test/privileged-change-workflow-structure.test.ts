import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Privileged change workflow structure (unit)", () => {
  const workflow = readFileSync(".github/workflows/privileged-change.yml", "utf8");

  it("uses pull_request_target with required activity types only", () => {
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("opened");
    expect(workflow).toContain("reopened");
    expect(workflow).toContain("synchronize");
    expect(workflow).toContain("labeled");
    expect(workflow).toContain("unlabeled");
    expect(workflow).not.toContain("pull_request:");
  });

  it("limits permissions to read PR/issue/status writes", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("statuses: write");
    expect(workflow).not.toContain("contents: write");
  });

  it("does not check out the PR head ref", () => {
    expect(workflow).not.toMatch(/uses:\s+actions\/checkout@[^\n]+\n[^\n]*ref:/);
    expect(workflow).not.toContain("ref: ${{ github.event.pull_request.head");
  });

  it("passes PR values through env only, not inline in run", () => {
    expect(workflow).toContain("PR_NUMBER: ${{ github.event.pull_request.number }}");
    expect(workflow).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("EVENT_ACTION: ${{ github.event.action }}");
    expect(workflow).toMatch(/run: node scripts\/privileged-change-github\.mjs\s*$/m);
    expect(workflow).not.toMatch(/run:[^\n]*github\.event/);
  });

  it("checks out base ref with persist-credentials disabled", () => {
    expect(workflow).toContain("persist-credentials: false");
  });

  it("restricts to same-repo PRs", () => {
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  it("delegates analysis to trusted scripts on default checkout", () => {
    expect(workflow).toContain("privileged-change-github.mjs");
    expect(workflow).toContain("actions/checkout@");
  });
});
