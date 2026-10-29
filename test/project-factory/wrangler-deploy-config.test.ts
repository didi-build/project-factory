import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}

type WorkflowStep = {
  env?: Record<string, unknown>;
};

type DeployWorkflow = {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
};

describe("wrangler and deploy production config", () => {
  it("keeps workers.dev on and preview URLs off in wrangler.jsonc", () => {
    const wrangler = parseJsonc(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"));
    expect(wrangler.workers_dev).toBe(true);
    expect(wrangler.preview_urls).toBe(false);
  });

  it("does not set WRANGLER_LOG or WRANGLER_LOG_SANITIZE on any deploy workflow step", () => {
    const deployText = readFileSync(
      join(repoRoot, ".github/workflows/deploy.yml"),
      "utf8",
    );
    const workflow = parseYaml(deployText) as DeployWorkflow;
    const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
    for (const step of steps) {
      const env = step.env ?? {};
      expect(env).not.toHaveProperty("WRANGLER_LOG");
      expect(env).not.toHaveProperty("WRANGLER_LOG_SANITIZE");
    }
  });
});
