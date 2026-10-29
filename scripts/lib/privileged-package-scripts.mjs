import { pullFilePathnames } from "./privileged-pull-files-api.mjs";

export const packageJsonPath = "package.json";

/**
 * @param {{ filename: string; status: string; previous_filename?: string }[]} changedFiles
 * @returns {boolean}
 */
export function packageJsonAmongChangedFiles(changedFiles) {
  return changedFiles.some((file) => pullFilePathnames(file).includes(packageJsonPath));
}

/**
 * @param {unknown} pkg
 * @returns {{ ok: true; scripts: Record<string, string> } | { ok: false; message: string }}
 */
export function extractNpmScriptsField(pkg) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { ok: false, message: "root is not an object" };
  }
  const record = /** @type {{ scripts?: unknown }} */ (pkg);
  if (record.scripts === undefined) {
    return { ok: true, scripts: {} };
  }
  if (
    typeof record.scripts !== "object" ||
    record.scripts === null ||
    Array.isArray(record.scripts)
  ) {
    return { ok: false, message: "scripts is not an object" };
  }
  /** @type {Record<string, string>} */
  const scripts = {};
  for (const [key, value] of Object.entries(record.scripts)) {
    if (typeof value !== "string") {
      return { ok: false, message: "scripts values must be strings" };
    }
    scripts[key] = value;
  }
  return { ok: true, scripts };
}

/**
 * @param {Record<string, string>} scripts
 * @returns {string}
 */
export function stableScriptsJson(scripts) {
  const sorted = Object.keys(scripts).sort();
  /** @type {Record<string, string>} */
  const normalized = {};
  for (const key of sorted) {
    normalized[key] = scripts[key];
  }
  return JSON.stringify(normalized);
}

/**
 * @typedef {{ severity: 'high' | 'normal'; message: string }} PackageJsonFinding
 * @typedef {{ ok: true; text: string } | { ok: false; reason: string }} ReadResult
 */

/**
 * @param {{ filename: string; status: string; previous_filename?: string }[]} changedFiles
 * @param {(ref: string) => ReadResult} readContentAtRef
 * @param {string} baseSha
 * @param {string} headSha
 * @returns {{
 *   findings: PackageJsonFinding[];
 *   flagPackageJson: boolean;
 * }}
 */
export function assessPackageJsonScriptsChange(
  changedFiles,
  readContentAtRef,
  baseSha,
  headSha,
) {
  if (!packageJsonAmongChangedFiles(changedFiles)) {
    return { findings: [], flagPackageJson: false };
  }

  /** @type {PackageJsonFinding[]} */
  const findings = [];

  const baseRead = readContentAtRef(baseSha);
  if (!baseRead.ok) {
    findings.push({
      severity: "high",
      message: `package.json: could not read at base ref (${baseRead.reason})`,
    });
    return { findings, flagPackageJson: true };
  }

  const headRead = readContentAtRef(headSha);
  if (!headRead.ok) {
    findings.push({
      severity: "high",
      message: `package.json: could not read at head ref (${headRead.reason})`,
    });
    return { findings, flagPackageJson: true };
  }

  let basePkg;
  let headPkg;
  try {
    basePkg = JSON.parse(baseRead.text);
  } catch {
    findings.push({
      severity: "high",
      message: "package.json: invalid JSON at base ref",
    });
    return { findings, flagPackageJson: true };
  }
  try {
    headPkg = JSON.parse(headRead.text);
  } catch {
    findings.push({
      severity: "high",
      message: "package.json: invalid JSON at head ref",
    });
    return { findings, flagPackageJson: true };
  }

  const baseScripts = extractNpmScriptsField(basePkg);
  if (!baseScripts.ok) {
    findings.push({
      severity: "high",
      message: `package.json: ${baseScripts.message} at base ref`,
    });
    return { findings, flagPackageJson: true };
  }

  const headScripts = extractNpmScriptsField(headPkg);
  if (!headScripts.ok) {
    findings.push({
      severity: "high",
      message: `package.json: ${headScripts.message} at head ref`,
    });
    return { findings, flagPackageJson: true };
  }

  if (
    stableScriptsJson(baseScripts.scripts) !== stableScriptsJson(headScripts.scripts)
  ) {
    findings.push({
      severity: "high",
      message: "package.json: npm scripts changed",
    });
    return { findings, flagPackageJson: true };
  }

  return { findings: [], flagPackageJson: false };
}

/**
 * @param {{
 *   flagged: boolean;
 *   privilegedFiles: string[];
 *   findings: { severity: string; message: string }[];
 *   workflowDetails: Record<string, unknown>;
 * }} analysis
 * @param {{ findings: PackageJsonFinding[]; flagPackageJson: boolean }} assessment
 */
export function mergePackageJsonScriptsAssessment(analysis, assessment) {
  if (!assessment.flagPackageJson && assessment.findings.length === 0) {
    return analysis;
  }

  const privilegedFiles = [...analysis.privilegedFiles];
  if (assessment.flagPackageJson && !privilegedFiles.includes(packageJsonPath)) {
    privilegedFiles.push(packageJsonPath);
    privilegedFiles.sort();
  }

  const seen = new Set(analysis.findings.map((f) => f.message));
  /** @type {typeof analysis.findings} */
  const findings = [...analysis.findings];
  for (const finding of assessment.findings) {
    if (seen.has(finding.message)) {
      continue;
    }
    seen.add(finding.message);
    findings.push(finding);
  }

  const sortFindings = (a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "high" ? -1 : 1;
    }
    return a.message.localeCompare(b.message);
  };

  return {
    ...analysis,
    privilegedFiles,
    findings: findings.sort(sortFindings),
    flagged: privilegedFiles.length > 0 || findings.length > 0,
  };
}

/**
 * @param {import("./privileged-gh-api.mjs").GhExec} exec
 * @param {Record<string, string | undefined>} env
 * @param {string} repo
 * @param {string} ref
 * @param {(exec: import("./privileged-gh-api.mjs").GhExec, env: Record<string, string | undefined>, args: string[], input?: string) => string} ghApi
 * @returns {ReadResult}
 */
export function readPackageJsonViaContentsApi(exec, env, repo, ref, ghApi) {
  try {
    const contentJson = ghApi(exec, env, [
      `repos/${repo}/contents/${encodeURIComponent(packageJsonPath)}?ref=${ref}`,
    ]);
    const payload = JSON.parse(contentJson);
    if (!payload.content || payload.encoding !== "base64") {
      return { ok: false, reason: "missing base64 content" };
    }
    return {
      ok: true,
      text: Buffer.from(payload.content, "base64").toString("utf8"),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: message || "read failed" };
  }
}
