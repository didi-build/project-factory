const USES_RE = /^\s*(?:-\s+)?uses:\s+([^@\s]+)@/gim;
const USES_DOCKER_TEST = /^\s*(?:-\s+)?uses:\s+docker:\/\//im;
const SECRET_RE = /secrets\.([A-Za-z0-9_]+)/gi;
const SECRET_EXPR_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/gi;
const ENV_LINE_RE = /^\s*environment:\s*([^\s#]+)\s*$/gim;
const ON_BLOCK_TRIGGER_RE =
  /^\s{0,2}(pull_request_target|pull_request|push|workflow_dispatch|workflow_call|schedule|repository_dispatch|release|issues|issue_comment|discussion|discussion_comment|workflow_run|registry_package|watch|fork|create|delete|pull_request_review|pull_request_review_comment|check_run|check_suite|status|deployment|deployment_status|public|label|milestone|project|project_card|project_column|package|page_build|member|team_add|star|gollum|commit_comment|merge_group)(?:\s*:|$)/gim;

const PRIVILEGED_ENVIRONMENT_NAMES = ["production", "migrate-nonprod"];
const CLOUDFLARE_TOKEN_SECRET_RE = /CLOUDFLARE_API_TOKEN_[A-Za-z0-9_]+/gi;

/**
 * @param {string} usesValue e.g. actions/checkout or didi-build/foo/bar
 * @returns {string | null} owner segment, or null for local ./ paths
 */
export function parseUsesOwner(usesValue) {
  const trimmed = usesValue.trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return null;
  }
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    return trimmed;
  }
  return trimmed.slice(0, slash);
}

/**
 * @param {string} content
 * @returns {{
 *   environments: string[];
 *   secrets: string[];
 *   triggers: string[];
 *   permissionKeys: string[];
 *   usesOwners: string[];
 * }}
 */
export function extractWorkflowMetadata(content) {
  const environments = new Set();
  const secrets = new Set();
  const triggers = new Set();
  const permissionKeys = new Set();
  const usesOwners = new Set();

  for (const match of content.matchAll(USES_RE)) {
    const owner = parseUsesOwner(match[1]);
    if (owner) {
      usesOwners.add(owner);
    }
  }

  if (USES_DOCKER_TEST.test(content)) {
    usesOwners.add("docker");
  }

  for (const match of content.matchAll(SECRET_RE)) {
    secrets.add(match[1].toUpperCase());
  }
  for (const match of content.matchAll(SECRET_EXPR_RE)) {
    secrets.add(match[1].toUpperCase());
  }

  for (const match of content.matchAll(ENV_LINE_RE)) {
    const value = match[1].trim();
    if (!value.startsWith("${{")) {
      environments.add(value);
    }
  }

  const lines = content.split("\n");
  let inPermissions = false;
  let permissionsIndent = 0;
  let inEnvironmentBlock = false;
  let environmentIndent = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^\s*permissions:\s*$/i.test(line)) {
      inPermissions = true;
      permissionsIndent = line.match(/^\s*/)?.[0].length ?? 0;
      continue;
    }
    if (inPermissions) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && indent <= permissionsIndent) {
        inPermissions = false;
      } else {
        const keyMatch = /^\s+([a-z-]+):/i.exec(line);
        if (keyMatch) {
          permissionKeys.add(keyMatch[1].toLowerCase());
        }
      }
    }

    if (/^\s*environment:\s*$/i.test(line)) {
      inEnvironmentBlock = true;
      environmentIndent = line.match(/^\s*/)?.[0].length ?? 0;
      continue;
    }
    if (inEnvironmentBlock) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && indent <= environmentIndent) {
        inEnvironmentBlock = false;
      } else {
        const nameMatch = /^\s+name:\s*([^\s#${}]+)/i.exec(line);
        if (nameMatch) {
          environments.add(nameMatch[1].trim());
        }
      }
    }
  }

  for (const match of content.matchAll(ON_BLOCK_TRIGGER_RE)) {
    triggers.add(match[1].toLowerCase());
  }

  return {
    environments: [...environments].sort((a, b) => a.localeCompare(b)),
    secrets: [...secrets].sort(),
    triggers: [...triggers].sort(),
    permissionKeys: [...permissionKeys].sort(),
    usesOwners: [...usesOwners].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * @param {string} content
 * @returns {string[]}
 */
export function findHighSeverityContentSignals(content) {
  const signals = [];
  if (/\bpull_request_target\b/i.test(content)) {
    signals.push("trigger: pull_request_target");
  }
  for (const env of PRIVILEGED_ENVIRONMENT_NAMES) {
    if (new RegExp(`\\b${env}\\b`, "i").test(content)) {
      signals.push(`environment reference: ${env}`);
    }
  }
  for (const match of content.matchAll(CLOUDFLARE_TOKEN_SECRET_RE)) {
    signals.push(`secret name: ${match[0].toUpperCase()}`);
  }
  if (USES_DOCKER_TEST.test(content)) {
    signals.push("uses: docker://...");
  }
  if (/secrets:\s*inherit\b/i.test(content)) {
    signals.push("secrets: inherit");
  }
  return [...new Set(signals)].sort();
}

/**
 * @param {string[]} usesOwners
 * @param {string} trustedOrg
 * @returns {string[]}
 */
export function findUntrustedUsesOwners(usesOwners, trustedOrg) {
  const allowed = new Set(["actions", trustedOrg.toLowerCase()]);
  return usesOwners.filter((owner) => !allowed.has(owner.toLowerCase()));
}
