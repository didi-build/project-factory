import { describe, expect, it } from "vitest";
import {
  assessPackageJsonScriptsChange,
  extractNpmScriptsField,
  mergePackageJsonScriptsAssessment,
  packageJsonAmongChangedFiles,
  readPackageJsonViaContentsApi,
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

  it("flags fail closed when JSON parse fails at base ref", () => {
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

  it("flags fail closed when head read fails", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) =>
        ref === headSha
          ? { ok: false, reason: "HTTP 404" }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain("head ref");
  });

  it("flags fail closed when JSON parse fails at head ref", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) =>
        ref === headSha
          ? { ok: true, text: "not-json" }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain("invalid JSON at head ref");
  });

  it("flags fail closed when scripts is not an object at head ref", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "modified" }],
      (ref) =>
        ref === headSha
          ? { ok: true, text: '{"scripts":[]}' }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain(
      "scripts is not an object at head ref",
    );
  });

  it("packageJsonAmongChangedFiles matches previous_filename on rename away", () => {
    expect(
      packageJsonAmongChangedFiles([
        {
          filename: "package.json.bak",
          previous_filename: "package.json",
          status: "renamed",
        },
      ]),
    ).toBe(true);
  });

  it("packageJsonAmongChangedFiles matches rename into package.json", () => {
    expect(
      packageJsonAmongChangedFiles([
        {
          filename: "package.json",
          previous_filename: "package.json.example",
          status: "renamed",
        },
      ]),
    ).toBe(true);
  });

  it("flags fail closed when added package.json cannot read base", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "added" }],
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

  it("flags fail closed when removed package.json cannot read head", () => {
    const result = assessPackageJsonScriptsChange(
      [{ filename: "package.json", status: "removed" }],
      (ref) =>
        ref === headSha
          ? { ok: false, reason: "HTTP 404" }
          : { ok: true, text: '{"scripts":{}}' },
      baseSha,
      headSha,
    );
    expect(result.flagPackageJson).toBe(true);
    expect(result.findings[0]?.message).toContain("head ref");
  });

  describe("readPackageJsonViaContentsApi", () => {
    const repo = "didi-build/project-factory";
    const ref = "deadbeef";

    it("returns read failure when ghApi throws", () => {
      const exec = () => {
        throw new Error("should not run");
      };
      const ghApi = () => {
        throw new Error("api down");
      };
      const result = readPackageJsonViaContentsApi(exec, {}, repo, ref, ghApi);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("api down");
      }
    });

    it("returns read failure when response is not base64 content", () => {
      const exec = () => "";
      const ghApi = () => JSON.stringify({ encoding: "utf8", content: "plain" });
      const result = readPackageJsonViaContentsApi(exec, {}, repo, ref, ghApi);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("missing base64 content");
      }
    });

    it("passes ref into the Contents API path", () => {
      /** @type {import("../scripts/lib/privileged-gh-api.mjs").GhExec} */
      const exec = () => "";
      let capturedPath = "";
      const ghApi = (
        _exec: import("../scripts/lib/privileged-gh-api.mjs").GhExec,
        _env: Record<string, string | undefined>,
        args: string[],
      ) => {
        capturedPath = args[0];
        return JSON.stringify({
          encoding: "base64",
          content: Buffer.from('{"scripts":{}}').toString("base64"),
        });
      };
      const result = readPackageJsonViaContentsApi(exec, {}, repo, ref, ghApi);
      expect(result.ok).toBe(true);
      expect(capturedPath).toContain(`ref=${ref}`);
    });
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
