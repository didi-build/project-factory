export const REPO_SECRET_CLOUDFLARE_ACCOUNT_ID = "CLOUDFLARE_ACCOUNT_ID";
export const REPO_SECRET_CLOUDFLARE_API_TOKEN_PREVIEW = "CLOUDFLARE_API_TOKEN_PREVIEW";
export const ENV_SECRET_CLOUDFLARE_API_TOKEN_PRODUCTION =
  "CLOUDFLARE_API_TOKEN_PRODUCTION";

export const GITHUB_ENV_PREVIEW = "preview";
export const GITHUB_ENV_PRODUCTION = "production";

export const FACTORY_WORKER_TAG = "project-factory";
export const PREVIEW_NAME_PATTERN = "pr-<n>";

export function productionWorkerName(projectName: string): string {
  return projectName;
}

export function previewWorkerName(projectName: string): string {
  return `${projectName}-preview`;
}

export function deployTokenName(
  projectName: string,
  kind: "production" | "preview",
): string {
  return `project-factory-${projectName}-deploy-${kind}`;
}

export function workerSubdomainUrl(
  workerName: string,
  accountSubdomain: string,
): string {
  return `https://${workerName}.${accountSubdomain}.workers.dev`;
}
