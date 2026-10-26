import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe("wrangler and deploy production config", () => {
  it("keeps workers.dev and preview URLs off in wrangler.jsonc", () => {
    const wrangler = parseJsonc(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"));
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.preview_urls).toBe(false);
  });

  it("sets WRANGLER_LOG=debug on the deploy step only", () => {
    const deploy = readFileSync(join(repoRoot, ".github/workflows/deploy.yml"), "utf8");
    const deployStep = deploy.slice(deploy.indexOf("- name: Deploy Worker"));
    expect(deployStep).toContain("WRANGLER_LOG: debug");
    const beforeDeployStep = deploy.slice(0, deploy.indexOf("- name: Deploy Worker"));
    expect(beforeDeployStep).not.toContain("WRANGLER_LOG");
  });
});
