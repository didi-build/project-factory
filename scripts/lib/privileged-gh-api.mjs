/**
 * Build argv for `gh` when calling `gh api` (stdin body requires `--input -`).
 *
 * @param {string[]} args arguments after `api` (method, path, flags)
 * @param {boolean} hasInput
 * @returns {string[]}
 */
export function buildGhApiArgs(args, hasInput) {
  if (hasInput) {
    return ["api", ...args, "--input", "-"];
  }
  return ["api", ...args];
}

/**
 * Node's default `maxBuffer` for `execFileSync` / `spawnSync` is 1 MiB. Large
 * `gh api --paginate --slurp` responses (e.g. compare across many merges) exceed
 * that and raise ENOBUFS without an explicit limit.
 */
export const GH_API_EXEC_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @returns {string}
 */
export function formatGhApiExecBufferExceededDetail() {
  const mib = GH_API_EXEC_MAX_BUFFER / (1024 * 1024);
  return `GitHub API response exceeded the child-process output buffer limit (${mib} MiB)`;
}

/**
 * @typedef {(file: string, args: string[], options?: { encoding?: string; input?: string; env?: Record<string, string | undefined>; stdio?: string; maxBuffer?: number }) => string} GhExec
 */

/**
 * @param {GhExec} exec
 * @param {Record<string, string | undefined>} env
 * @param {string[]} args
 * @param {string} [input]
 * @returns {string}
 */
export function ghApiCall(exec, env, args, input) {
  const hasInput = input !== undefined;
  return exec("gh", buildGhApiArgs(args, hasInput), {
    encoding: "utf8",
    input: hasInput ? input : undefined,
    maxBuffer: GH_API_EXEC_MAX_BUFFER,
    env: {
      ...env,
      GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN,
    },
  });
}
