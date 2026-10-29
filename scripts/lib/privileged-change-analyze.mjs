import {
  isPrivilegedFlagInfrastructurePath,
  isPrivilegedPath,
  isWorkflowFile,
} from "./privileged-paths.mjs";
import { pullFilePathnames } from "./privileged-pull-files-api.mjs";
import {
  extractWorkflowMetadata,
  findHighSeverityContentSignals,
  findUntrustedUsesOwners,
} from "./privileged-workflow-extract.mjs";

/**
 * @typedef {{ filename: string; status: string; previous_filename?: string }} ChangedFile
 * @typedef {{ severity: 'high' | 'normal'; message: string }} Finding
 */

/**
 * @param {ChangedFile[]} changedFiles
 * @param {Record<string, string>} workflowContentsByPath
 * @param {{ trustedOrg: string }} options
 * @returns {{
 *   flagged: boolean;
 *   privilegedFiles: string[];
 *   findings: Finding[];
 *   workflowDetails: Record<string, ReturnType<typeof extractWorkflowMetadata>>;
 * }}
 */
export function analyzePrivilegedChange(
  changedFiles,
  workflowContentsByPath,
  { trustedOrg },
) {
  const privilegedFiles = [
    ...new Set(
      changedFiles.flatMap((file) =>
        pullFilePathnames(file).filter((pathname) => isPrivilegedPath(pathname)),
      ),
    ),
  ].sort();

  /** @type {Finding[]} */
  const findings = [];
  /** @type {Record<string, ReturnType<typeof extractWorkflowMetadata>>} */
  const workflowDetails = {};

  for (const file of changedFiles) {
    for (const pathname of pullFilePathnames(file)) {
      if (isPrivilegedFlagInfrastructurePath(pathname)) {
        findings.push({
          severity: "high",
          message: `Changes privileged-change flag infrastructure (${pathname})`,
        });
      }
    }
  }

  for (const file of changedFiles) {
    if (!isWorkflowFile(file.filename)) {
      continue;
    }
    if (file.status === "added") {
      findings.push({
        severity: "high",
        message: `New workflow file: ${file.filename}`,
      });
    }

    const content = workflowContentsByPath[file.filename];
    if (!content) {
      continue;
    }

    const meta = extractWorkflowMetadata(content);
    workflowDetails[file.filename] = meta;

    for (const signal of findHighSeverityContentSignals(content)) {
      findings.push({
        severity: "high",
        message: `${file.filename}: ${signal}`,
      });
    }

    for (const owner of findUntrustedUsesOwners(meta.usesOwners, trustedOrg)) {
      findings.push({
        severity: "high",
        message: `${file.filename}: third-party action owner: ${owner}`,
      });
    }

    for (const env of meta.environments) {
      const normalized = env.toLowerCase();
      if (normalized === "production" || normalized === "migrate-nonprod") {
        findings.push({
          severity: "high",
          message: `${file.filename}: GitHub environment: ${env}`,
        });
      }
    }

    for (const secret of meta.secrets) {
      if (secret.toUpperCase().startsWith("CLOUDFLARE_API_TOKEN_")) {
        findings.push({
          severity: "high",
          message: `${file.filename}: secret reference: ${secret}`,
        });
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const finding of findings) {
    if (seen.has(finding.message)) {
      continue;
    }
    seen.add(finding.message);
    deduped.push(finding);
  }

  const flagged = privilegedFiles.length > 0 || deduped.length > 0;

  const sortFindings = (a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "high" ? -1 : 1;
    }
    return a.message.localeCompare(b.message);
  };

  return {
    flagged,
    privilegedFiles,
    findings: deduped.sort(sortFindings),
    workflowDetails,
  };
}

/**
 * @param {boolean} flagged
 * @param {string[]} prLabels
 * @returns {'success' | 'failure'}
 */
export function privilegedChangeCheckState(flagged, prLabels) {
  if (!flagged) {
    return "success";
  }
  if (prLabels.includes("privileged-change-reviewed")) {
    return "success";
  }
  return "failure";
}
