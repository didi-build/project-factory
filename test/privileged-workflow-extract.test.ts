import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractWorkflowMetadata,
  findHighSeverityContentSignals,
  findUntrustedUsesOwners,
} from "../scripts/lib/privileged-workflow-extract.mjs";

const fixtures = (name: string) =>
  readFileSync(join("test/fixtures/privileged-workflows", name), "utf8");

describe("privileged-workflow-extract (unit)", () => {
  it("detects migrate-nonprod environment", () => {
    const meta = extractWorkflowMetadata(fixtures("migrate-nonprod-env.yml"));
    expect(meta.environments).toContain("migrate-nonprod");
    expect(
      findHighSeverityContentSignals(fixtures("migrate-nonprod-env.yml")),
    ).toContain("environment reference: migrate-nonprod");
  });

  it("detects CLOUDFLARE_API_TOKEN secret reference", () => {
    const meta = extractWorkflowMetadata(fixtures("secrets-ref.yml"));
    expect(meta.secrets).toContain("CLOUDFLARE_API_TOKEN_PRODUCTION");
    expect(findHighSeverityContentSignals(fixtures("secrets-ref.yml"))).toContain(
      "secret name: CLOUDFLARE_API_TOKEN_PRODUCTION",
    );
  });

  it("detects pull_request_target trigger", () => {
    const meta = extractWorkflowMetadata(fixtures("pull-request-target.yml"));
    expect(meta.triggers).toContain("pull_request_target");
    expect(
      findHighSeverityContentSignals(fixtures("pull-request-target.yml")),
    ).toContain("trigger: pull_request_target");
  });

  it("flags third-party uses owners", () => {
    const meta = extractWorkflowMetadata(fixtures("third-party-uses.yml"));
    expect(findUntrustedUsesOwners(meta.usesOwners, "didi-build")).toEqual(["pnpm"]);
    expect(meta.usesOwners).toContain("actions");
  });

  it("flags docker:// uses as high severity", () => {
    expect(findHighSeverityContentSignals(fixtures("docker-uses.yml"))).toContain(
      "uses: docker://...",
    );
    expect(extractWorkflowMetadata(fixtures("docker-uses.yml")).usesOwners).toContain(
      "docker",
    );
  });

  it("flags secrets: inherit as high severity", () => {
    expect(findHighSeverityContentSignals(fixtures("secrets-inherit.yml"))).toContain(
      "secrets: inherit",
    );
  });

  it("matches uses owners case-insensitively for trusted org checks", () => {
    const meta = extractWorkflowMetadata(fixtures("case-mixed-uses.yml"));
    expect(findUntrustedUsesOwners(meta.usesOwners, "didi-build")).toEqual([]);
    expect(meta.usesOwners.map((o) => o.toLowerCase())).toContain("actions");
  });

  it("flags mixed-case third-party uses owners as untrusted", () => {
    const meta = extractWorkflowMetadata(fixtures("case-mixed-untrusted-pnpm.yml"));
    expect(findUntrustedUsesOwners(meta.usesOwners, "didi-build")).toEqual(["PNPM"]);
  });

  it("matches environments, secrets, and owners case-insensitively", () => {
    const meta = extractWorkflowMetadata(fixtures("case-mixed.yml"));
    expect(meta.environments.map((e) => e.toLowerCase())).toContain("production");
    expect(meta.secrets).toContain("CLOUDFLARE_API_TOKEN_PRODUCTION");
    expect(findHighSeverityContentSignals(fixtures("case-mixed.yml"))).toContain(
      "environment reference: production",
    );
  });
});
