import { describe, expect, it } from "vitest";
import {
  isPrivilegedPath,
  privilegedPathMatchers,
  privilegedTokenMintingPaths,
} from "../scripts/lib/privileged-paths.mjs";

describe("privileged-paths (table)", () => {
  const cases: { path: string; privileged: boolean }[] = [
    { path: ".github/workflows/ci.yml", privileged: true },
    { path: ".github/dependabot.yml", privileged: true },
    { path: "CODEOWNERS", privileged: false },
    { path: "wrangler.jsonc", privileged: true },
    { path: "wrangler.json", privileged: true },
    { path: "wrangler.toml", privileged: true },
    { path: "wrangler.ci.jsonc", privileged: true },
    { path: "src/auth/bearer.ts", privileged: true },
    { path: "src/auth/other.ts", privileged: true },
    { path: "src/github/jwt.ts", privileged: true },
    { path: "src/github/client.ts", privileged: true },
    { path: "src/github/dry-run-installation.ts", privileged: true },
    { path: "src/github/pem.ts", privileged: true },
    { path: "scripts/privileged-change-github.mjs", privileged: true },
    { path: "scripts/lib/privileged-paths.mjs", privileged: true },
    { path: "scripts/lib/privileged-pull-files-api.mjs", privileged: true },
    { path: "scripts/lib/privileged-gh-api.mjs", privileged: true },
    { path: "scripts/lib/gh-api-errors.mjs", privileged: true },
    { path: "scripts/check-secret-usage.mjs", privileged: true },
    { path: "scripts/dependabot-automerge.mjs", privileged: true },
    { path: ".github/workflows/privileged-change.yml", privileged: true },
    { path: "docs/decisions/0004-project-factory-architecture.md", privileged: false },
    { path: "src/tools/create-project-repo.ts", privileged: false },
    { path: "src/index.ts", privileged: false },
    { path: "package.json", privileged: false },
  ];

  for (const { path, privileged } of cases) {
    it(`${path} privileged=${privileged}`, () => {
      expect(isPrivilegedPath(path)).toBe(privileged);
    });
  }

  it("documents matcher ids for review", () => {
    expect(privilegedPathMatchers.map((m) => m.id)).toEqual([
      "github-tree",
      "wrangler-config",
      "src-auth",
      "src-github",
      "token-mint-jwt",
      "token-mint-client",
      "token-mint-dry-run",
      "privileged-change-scripts",
      "privileged-lib",
      "secret-usage",
      "dependabot-automerge",
      "gh-api-errors",
      "privileged-change-workflow",
    ]);
  });

  it("lists token-minting paths explicitly", () => {
    expect(privilegedTokenMintingPaths).toEqual([
      "src/github/jwt.ts",
      "src/github/client.ts",
      "src/github/dry-run-installation.ts",
    ]);
    for (const path of privilegedTokenMintingPaths) {
      expect(isPrivilegedPath(path)).toBe(true);
    }
  });
});
