/**
 * Paths whose changes can reach privileged credentials or deploy infrastructure.
 * Read from trusted code on `main` (pull_request_target workflow).
 *
 * Token-minting sources (explicit list, also covered by `src-github`):
 * - src/github/jwt.ts (GitHub App JWT)
 * - src/github/client.ts (installation access token mint)
 * - src/github/dry-run-installation.ts (dry-run installation token mint)
 */

export const privilegedPathsConfigPath = "scripts/lib/privileged-paths.mjs";

export const privilegedChangeWorkflowPath = ".github/workflows/privileged-change.yml";

export const secretUsageScriptPath = "scripts/check-secret-usage.mjs";

export const ghApiErrorsPath = "scripts/lib/gh-api-errors.mjs";

/** @type {readonly string[]} */
export const privilegedTokenMintingPaths = [
  "src/github/jwt.ts",
  "src/github/client.ts",
  "src/github/dry-run-installation.ts",
];

/** @type {readonly string[]} */
export const privilegedCtoAdditionalPaths = [
  "src/env.ts",
  "src/cloudflare/dry-run-reads.ts",
  "src/linear/client.ts",
  ".secretlintrc.json",
  "scripts/bootstrap.mjs",
  "scripts/verify-action-pins.mjs",
];

/** @type {readonly string[]} */
export const privilegedBootstrapLibPaths = [
  "scripts/lib/bootstrap.mjs",
  "scripts/lib/bootstrap-install.mjs",
  "scripts/lib/bootstrap-token-env.mjs",
];

/** @type {readonly { id: string; infrastructure?: boolean; test: (filename: string) => boolean }[]} */
export const privilegedPathMatchers = [
  {
    id: "github-tree",
    test: (filename) => filename.startsWith(".github/"),
  },
  {
    id: "wrangler-config",
    test: (filename) => /^wrangler[^/]*\.(jsonc?|toml)$/.test(filename),
  },
  {
    id: "src-auth",
    test: (filename) => filename.startsWith("src/auth/"),
  },
  {
    id: "src-github",
    test: (filename) => filename.startsWith("src/github/"),
  },
  {
    id: "token-mint-jwt",
    test: (filename) => filename === "src/github/jwt.ts",
  },
  {
    id: "token-mint-client",
    test: (filename) => filename === "src/github/client.ts",
  },
  {
    id: "token-mint-dry-run",
    test: (filename) => filename === "src/github/dry-run-installation.ts",
  },
  {
    id: "src-env",
    test: (filename) => filename === "src/env.ts",
  },
  {
    id: "src-cloudflare-dry-run-reads",
    test: (filename) => filename === "src/cloudflare/dry-run-reads.ts",
  },
  {
    id: "src-linear-client",
    test: (filename) => filename === "src/linear/client.ts",
  },
  {
    id: "secretlintrc",
    test: (filename) => filename === ".secretlintrc.json",
  },
  {
    id: "bootstrap-script",
    test: (filename) => filename === "scripts/bootstrap.mjs",
  },
  {
    id: "bootstrap-lib",
    test: (filename) => /^scripts\/lib\/bootstrap[^/]*\.mjs$/.test(filename),
  },
  {
    id: "verify-action-pins",
    test: (filename) => filename === "scripts/verify-action-pins.mjs",
  },
  {
    id: "privileged-change-scripts",
    infrastructure: true,
    test: (filename) => /^scripts\/privileged-change-[^/]+\.mjs$/.test(filename),
  },
  {
    id: "privileged-lib",
    infrastructure: true,
    test: (filename) => /^scripts\/lib\/privileged-[^/]+\.mjs$/.test(filename),
  },
  {
    id: "secret-usage",
    infrastructure: true,
    test: (filename) => filename === secretUsageScriptPath,
  },
  {
    id: "dependabot-automerge",
    infrastructure: true,
    test: (filename) => filename === "scripts/dependabot-automerge.mjs",
  },
  {
    id: "gh-api-errors",
    infrastructure: true,
    test: (filename) => filename === ghApiErrorsPath,
  },
  {
    id: "privileged-change-workflow",
    infrastructure: true,
    test: (filename) => filename === privilegedChangeWorkflowPath,
  },
];

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isPrivilegedFlagInfrastructurePath(filename) {
  return privilegedPathMatchers.some((m) => m.infrastructure && m.test(filename));
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isPrivilegedPath(filename) {
  return privilegedPathMatchers.some((m) => m.test(filename));
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isWorkflowFile(filename) {
  return (
    filename.startsWith(".github/workflows/") &&
    (filename.endsWith(".yml") || filename.endsWith(".yaml"))
  );
}
