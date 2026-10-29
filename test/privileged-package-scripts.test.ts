import { describe, expect, it } from "vitest";
import {
  assessPackageJsonScriptsChange,
  extractNpmScriptsField,
  mergePackageJsonScriptsAssessment,
  stableScriptsJson,
} from "../scripts/lib/privileged-package-scripts.mjs";
import { analyzePrivilegedChange } from "../scripts/lib/privileged-change-analyze.mjs";

describe("privileged-package-scripts (unit)", () => {
  const baseSha = "base1111";
  const headSha = "head2222";

  it("flags when npm scripts differ", () => {
    const reads: Record<string, string> = {
      [baseSha]: JSON.stringify({
        name: "x",
        scripts: { check: "npm test", lint: "eslint ." },
      }),
      [headSha]: JSON.stringify({
        name: "x",
        scripts: { check: "npm test", lint: "eslint .", extra: "echo hi" },
      }),
    };
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) => {
        const text = reads[ref];
        return text ? { ok: true, text } : { ok: false, reason: "missing" };
      },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings.some((f) => f.message.includes("npm scripts changed"))).toBe(
      true,
    );
  });

  it("does not flag dependency-only package.json changes", () => {
    const reads: Record<string, string> = {
      [baseSha]: JSON.stringify({
        name: "x",
        scripts: { check: "npm run test" },
        dependencies: { zod: "1.0.0" },
      }),
      [headSha]: JSON.stringify({
        name: "x",
        scripts: { check: "npm run test" },
        dependencies: { zod: "2.0.0" },
      }),
    };
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) => ({ ok: true, text: reads[ref] }),
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("flags fail closed when base read fails", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) =>
        ref === baseSha
          ? { ok: false, reason: "HTTP 404" }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain("base ref");
  });

  it("flags fail closed when JSON parse fails", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) =>
        ref === baseSha
          ? { ok: true, text: "{" }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain("invalid JSON at base ref");
  });

  it("merge adds package.json to privilegedFiles when flagged", () => {
    const base = analyzePrivilegedChange([], {}, { trustedOrg: "didi-build" });
    const merged = mergePackageJsonScriptsAssessment(base, {
      flagPackageJson: true,
      findings: [{ severity: "high", message: "package.json: npm scripts changed" }],
    });
    expect(merged.flagged).toBe(true);
    expect(merged.privilegedFiles).toContain("package.json");
  });

  it("stableScriptsJson ignores key order", () => {
    expect(stableScriptsJson({ b: "2", a: "1" })).toBe(
      stableScriptsJson({ a: "1", b: "2" }),
    );
  });

  it("extractNpmScriptsField rejects non-string script values", () => {
    expect(extractNpmScriptsField({ scripts: { check: 1 } }).ok).toBe(false);
  });
});
