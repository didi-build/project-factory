import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = join(process.cwd(), ".github/workflows");

const forbiddenSecretPatterns = [
  "PROJECT_FACTORY_GH_PRIVATE_KEY",
  "PROJECT_FACTORY_LINEAR_API_KEY",
  "PROJECT_FACTORY_CLOUDFLARE_API_TOKEN",
  "PROJECT_FACTORY_BEARER_TOKEN",
  "CLOUDFLARE_API_TOKEN_PREVIEW",
];

describe("workflow structure", () => {
  it("does not expose factory or preview secrets on pull_request CI", () => {
    const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(ci).toContain("pull_request");
    for (const pattern of forbiddenSecretPatterns) {
      expect(ci).not.toContain(pattern);
    }
    expect(ci).not.toMatch(/environment:\s*production/i);
  });

  it("deploys production only from deploy.yml on main with production environment", () => {
    const deploy = readFileSync(join(workflowsDir, "deploy.yml"), "utf8");
    expect(deploy).toContain("branches: [main]");
    expect(deploy).toContain("environment: production");
    expect(deploy).toContain("CLOUDFLARE_API_TOKEN_PRODUCTION");
    expect(deploy).not.toContain("pull_request");
  });

  it("does not define a factory preview deploy workflow", () => {
    const files = readdirSync(workflowsDir);
    expect(files).not.toContain("preview.yml");
  });
});
