import { describe, expect, it } from "vitest";
import {
  flattenPullFilesPayload,
  normalizePullFileEntry,
  parseGhApiPaginatedSlurpedStdout,
  parsePullRequestFilesApiStdout,
  shouldFetchWorkflowFileContent,
} from "../scripts/lib/privileged-pull-files-api.mjs";

describe("privileged-pull-files-api (unit)", () => {
  it("parses two-page slurped issue comments", () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: `comment ${i}`,
      user: { login: "user" },
    }));
    const page2 = [
      {
        id: 101,
        body: "<!-- we-met-migrate-nonprod -->",
        user: { login: "github-actions[bot]" },
      },
    ];
    const stdout = JSON.stringify([page1, page2]);
    const flat = parseGhApiPaginatedSlurpedStdout(stdout);
    expect(flat).toHaveLength(101);
    expect(flat[100]).toEqual(page2[0]);
  });

  it("parses pretty-printed single JSON array (whole-output parse)", () => {
    const stdout = `[
  { "filename": "a.txt", "status": "modified" },
  { "filename": "b.txt", "status": "added" }
]`;
    expect(parsePullRequestFilesApiStdout(stdout)).toEqual([
      { filename: "a.txt", status: "modified" },
      { filename: "b.txt", status: "added" },
    ]);
  });

  it("parses a flat JSON array", () => {
    const stdout = JSON.stringify([
      { filename: "a.txt", status: "modified" },
      { filename: "b.txt", status: "added" },
    ]);
    expect(parsePullRequestFilesApiStdout(stdout)).toEqual([
      { filename: "a.txt", status: "modified" },
      { filename: "b.txt", status: "added" },
    ]);
  });

  it("includes previous_filename on renames", () => {
    const stdout = JSON.stringify([
      {
        filename: "docs/readme.md",
        previous_filename: "wrangler.jsonc",
        status: "renamed",
      },
    ]);
    expect(parsePullRequestFilesApiStdout(stdout)).toEqual([
      {
        filename: "docs/readme.md",
        previous_filename: "wrangler.jsonc",
        status: "renamed",
      },
    ]);
  });

  it("flags privileged path from rename previous_filename via analyze", async () => {
    const { analyzePrivilegedChange } =
      await import("../scripts/lib/privileged-change-analyze.mjs");
    const result = analyzePrivilegedChange(
      [
        {
          filename: "docs/readme.md",
          previous_filename: "wrangler.jsonc",
          status: "renamed",
        },
      ],
      {},
      { trustedOrg: "didi-build" },
    );
    expect(result.flagged).toBe(true);
    expect(result.privilegedFiles).toContain("wrangler.jsonc");
  });

  it("parses slurped single page ([[...]])", () => {
    const page = [
      { filename: "a.txt", status: "modified" },
      { filename: "b.txt", status: "added" },
    ];
    const stdout = JSON.stringify([page]);
    expect(parsePullRequestFilesApiStdout(stdout)).toEqual(page);
  });

  it("parses slurped two pages", () => {
    const page1 = [{ filename: "one.ts", status: "modified" }];
    const page2 = [{ filename: "two.ts", status: "added" }];
    const stdout = JSON.stringify([page1, page2]);
    expect(parsePullRequestFilesApiStdout(stdout)).toEqual([
      { filename: "one.ts", status: "modified" },
      { filename: "two.ts", status: "added" },
    ]);
  });

  it("parses two paginated pages (one array per line)", () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file-${i}.ts`,
      status: "modified",
    }));
    const page2 = [{ filename: "src/file-100.ts", status: "added" }];
    const stdout = `${JSON.stringify(page1)}\n${JSON.stringify(page2)}`;
    const files = parsePullRequestFilesApiStdout(stdout);
    expect(files).toHaveLength(101);
    expect(files[100]).toEqual({ filename: "src/file-100.ts", status: "added" });
  });

  it("throws when an entry is missing filename", () => {
    expect(() => normalizePullFileEntry({ status: "modified" }, 0)).toThrow(
      /missing string filename/,
    );
    expect(() =>
      parsePullRequestFilesApiStdout(JSON.stringify([{ status: "added" }])),
    ).toThrow(/missing string filename/);
  });

  it("flattenPullFilesPayload leaves non-nested arrays unchanged", () => {
    const flat = [{ filename: "x", status: "modified" }];
    expect(flattenPullFilesPayload(flat)).toEqual(flat);
  });

  it("skips workflow content fetch for removed files only", () => {
    expect(shouldFetchWorkflowFileContent("removed")).toBe(false);
    expect(shouldFetchWorkflowFileContent("renamed")).toBe(true);
    expect(shouldFetchWorkflowFileContent("modified")).toBe(true);
  });
});
