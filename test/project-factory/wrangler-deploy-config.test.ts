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

function assertNoWranglerLogEnv(env: Record<string, unknown>): void {
  expect(env).not.toHaveProperty("WRANGLER_LOG");
  expect(env).not.toHaveProperty("WRANGLER_LOG_SANITIZE");
}

type WorkflowStep = {
  env?: Record<string, unknown>;
};

type DeployWorkflow = {
  env?: Record<string, unknown>;
  jobs?: Record<string, { env?: Record<string, unknown>; steps?: WorkflowStep[] }>;
};

describe("wrangler and deploy production config", () => {
  it("keeps workers.dev on and preview URLs off in wrangler.jsonc", () => {
    const wrangler = parseJsonc(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"));
    expect(wrangler.workers_dev).toBe(true);
    expect(wrangler.preview_urls).toBe(false);
  });

  it("does not set wrangler debug env vars anywhere in deploy.yml", () => {
    const deployText = readFileSync(
      join(repoRoot, ".github/workflows/deploy.yml"),
      "utf8",
    );
    expect(deployText).not.toContain("WRANGLER_LOG");

    const workflow = parseYaml(deployText) as DeployWorkflow;
    if (workflow.env) {
      assertNoWranglerLogEnv(workflow.env);
    }
    for (const job of Object.values(workflow.jobs ?? {})) {
      if (job.env) {
        assertNoWranglerLogEnv(job.env);
      }
      for (const step of job.steps ?? []) {
        assertNoWranglerLogEnv(step.env ?? {});
      }
    }
  });
});
