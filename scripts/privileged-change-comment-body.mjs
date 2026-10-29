#!/usr/bin/env node
/**
 * Build the GitHub PR comment body for privileged-change detection.
 * Usage: node scripts/privileged-change-comment-body.mjs <analysis-json>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PRIVILEGED_CHANGE_MARKER = "<!-- project-factory-privileged-change -->";

/**
 * @param {{
 *   flagged: boolean;
 *   privilegedFiles: string[];
 *   findings: { severity: string; message: string }[];
 *   workflowDetails: Record<string, {
 *     environments: string[];
 *     secrets: string[];
 *     triggers: string[];
 *     permissionKeys: string[];
 *     usesOwners: string[];
 *   }>;
 * }} analysis
 * @param {{ staleReviewNotice?: boolean }} [options]
 * @returns {string}
 */
export function buildPrivilegedChangeCommentBody(analysis, options = {}) {
  const { staleReviewNotice = false } = options;
  const lines = [PRIVILEGED_CHANGE_MARKER];

  if (!analysis.flagged) {
    lines.push(
      "",
      "## Privileged change cleared",
      "",
      "This PR no longer modifies privileged paths or workflow credential surfaces.",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    "## ⚠️ Privileged change detected",
    "",
    "This PR touches deploy infrastructure, workflows, or other paths that can reach privileged credentials. A maintainer should review before merge.",
  );

  if (staleReviewNotice) {
    lines.push(
      "",
      "> **New commits pushed:** the `privileged-change-reviewed` label was removed; privileged changes need re-review before merge.",
    );
  }

  const high = analysis.findings.filter((f) => f.severity === "high");
  const normal = analysis.findings.filter((f) => f.severity !== "high");

  if (high.length > 0) {
    lines.push("", "### High severity");
    for (const item of high) {
      lines.push(`- ${item.message}`);
    }
  }

  if (analysis.privilegedFiles.length > 0) {
    lines.push("", "### Changed privileged files");
    for (const file of analysis.privilegedFiles) {
      lines.push(`- \`${file}\``);
    }
  }

  const workflowPaths = Object.keys(analysis.workflowDetails).sort();
  if (workflowPaths.length > 0) {
    lines.push("", "### Workflow references");
    for (const path of workflowPaths) {
      const meta = analysis.workflowDetails[path];
      lines.push("", `**\`${path}\`**`);
      if (meta.triggers.length > 0) {
        lines.push(`- Triggers: ${meta.triggers.join(", ")}`);
      }
      if (meta.environments.length > 0) {
        lines.push(`- Environments: ${meta.environments.join(", ")}`);
      }
      if (meta.secrets.length > 0) {
        lines.push(`- Secrets: ${meta.secrets.join(", ")}`);
      }
      if (meta.permissionKeys.length > 0) {
        lines.push(`- Permissions: ${meta.permissionKeys.join(", ")}`);
      }
      if (meta.usesOwners.length > 0) {
        lines.push(`- Action owners: ${meta.usesOwners.join(", ")}`);
      }
    }
  }

  if (normal.length > 0) {
    lines.push("", "### Other notes");
    for (const item of normal) {
      lines.push(`- ${item.message}`);
    }
  }

  lines.push(
    "",
    "After review, a maintainer adds the `privileged-change-reviewed` label to clear the required check.",
  );

  return `${lines.join("\n")}\n`;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("privileged-change-comment-body: missing analysis JSON path");
    process.exit(1);
  }
  const analysis = JSON.parse(readFileSync(inputPath, "utf8"));
  process.stdout.write(buildPrivilegedChangeCommentBody(analysis));
}
