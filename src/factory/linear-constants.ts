export const DIDI_BUILD_LINEAR_TEAM_ID = "cff86df5-36a6-4c6a-8527-7ef0bee09c1e";

export const REPO_PROJECT_LABEL_GROUP_NAME = "repo";

export const KICKOFF_WORKFLOW_STATE_NAME = "Ready for CTO breakdown";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

export function linearRepoProjectLabelName(org: string, name: string): string {
  return `${org}/${name}`;
}
