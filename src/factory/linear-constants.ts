export const REPO_PROJECT_LABEL_GROUP_NAME = "repo";

export const KICKOFF_WORKFLOW_STATE_NAME = "Ready for CTO breakdown";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

export function linearRepoProjectLabelName(org: string, name: string): string {
  return `${org}/${name}`;
}
