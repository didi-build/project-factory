import { LinearClient } from "../../src/linear/client.js";
import { buildLinearApiKey } from "./linear-mock.js";

export type GraphqlCall = {
  query: string;
  variables?: unknown;
};

export type HarnessState = {
  teamId?: string;
  labelExists?: boolean;
  labelOutsideRepoGroup?: boolean;
  projectExists?: boolean;
  factoryMarker?: boolean;
  kickoffExists?: boolean;
  kickoffStateId?: string;
  ideaIssue?: boolean;
  ideaHasRelationToKickoff?: boolean;
  failMutation?: string;
};

export function createHarnessClient(
  state: HarnessState,
  calls: GraphqlCall[] = [],
): LinearClient {
  const TEAM_ID = state.teamId ?? "cff86df5-36a6-4c6a-8527-7ef0bee09c1e";
  const REPO_GROUP_ID = "group-repo-uuid";
  const LABEL_ID = "label-demo-uuid";
  const PROJECT_ID = "project-demo-uuid";
  const STATE_ID = state.kickoffStateId ?? "state-cto-uuid";
  const KICKOFF_ID = "kickoff-uuid";
  const IDEA_ID = "idea-uuid";

  return new LinearClient({
    apiKey: buildLinearApiKey(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as GraphqlCall;
      calls.push(body);
      const q = body.query;

      if (state.failMutation && q.includes(state.failMutation)) {
        return new Response(
          JSON.stringify({
            errors: [{ message: "mutation failed", extensions: { code: "X" } }],
          }),
          { status: 500 },
        );
      }

      if (q.includes("query Teams")) {
        return new Response(
          JSON.stringify({
            data: { teams: { nodes: [{ id: TEAM_ID, name: "Didi Build" }] } },
          }),
        );
      }
      if (q.includes("projectLabels")) {
        const nodes: unknown[] = [
          { id: REPO_GROUP_ID, name: "repo", isGroup: true, parent: null },
        ];
        if (state.labelExists || state.labelOutsideRepoGroup) {
          nodes.push({
            id: LABEL_ID,
            name: "didi-build/demo-app",
            isGroup: false,
            parent: state.labelOutsideRepoGroup
              ? { id: "wrong-group", name: "wrong" }
              : { id: REPO_GROUP_ID, name: "repo" },
          });
        }
        return new Response(JSON.stringify({ data: { projectLabels: { nodes } } }));
      }
      if (q.includes("ProjectsByLabel") || q.includes("ProjectsByName")) {
        if (state.projectExists) {
          const marker = state.factoryMarker ?? true;
          return new Response(
            JSON.stringify({
              data: {
                projects: {
                  nodes: [
                    {
                      id: PROJECT_ID,
                      name: "Demo App",
                      url: "https://linear.app/didi-build/project/demo",
                      description: marker
                        ? "A demo\n\nGitHub: https://github.com/didi-build/demo-app\n\n<!-- project-factory:demo-app -->"
                        : "foreign",
                      labels: {
                        nodes: [{ id: LABEL_ID, name: "didi-build/demo-app" }],
                      },
                      externalLinks: {
                        nodes: marker
                          ? [
                              {
                                id: "link-1",
                                url: "https://github.com/didi-build/demo-app",
                                label: "GitHub",
                              },
                            ]
                          : [],
                      },
                    },
                  ],
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify({ data: { projects: { nodes: [] } } }));
      }
      if (q.includes("WorkflowStates")) {
        return new Response(
          JSON.stringify({
            data: {
              workflowStates: {
                nodes: [{ id: STATE_ID, name: "Ready for CTO breakdown" }],
              },
            },
          }),
        );
      }
      if (q.includes("KickoffByMarker")) {
        if (state.kickoffExists) {
          return new Response(
            JSON.stringify({
              data: {
                issues: {
                  nodes: [
                    {
                      id: KICKOFF_ID,
                      identifier: "DIDI-900",
                      title: "Old title: kickoff",
                      url: "https://linear.app/didi-build/issue/DIDI-900",
                      description: `<!-- project-factory:epic:${PROJECT_ID} -->`,
                      state: { id: "other-state", name: "In development" },
                      relations: { nodes: [] },
                    },
                  ],
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }));
      }
      if (q.includes("IssueById")) {
        if (state.ideaIssue) {
          const relations = state.ideaHasRelationToKickoff
            ? [
                {
                  type: "related",
                  issue: { id: IDEA_ID, identifier: "DIDI-830" },
                  relatedIssue: { id: KICKOFF_ID, identifier: "DIDI-900" },
                },
              ]
            : [];
          return new Response(
            JSON.stringify({
              data: {
                issue: {
                  id: IDEA_ID,
                  identifier: "DIDI-830",
                  title: "Idea",
                  url: "https://linear.app/didi-build/issue/DIDI-830",
                  state: { id: "idea-state", name: "Backlog" },
                  relations: { nodes: relations },
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify({ data: { issue: null } }));
      }
      if (q.includes("ProjectLabelCreate")) {
        return new Response(
          JSON.stringify({
            data: {
              projectLabelCreate: {
                success: true,
                projectLabel: { id: LABEL_ID, name: "didi-build/demo-app" },
              },
            },
          }),
        );
      }
      if (q.includes("ProjectCreate")) {
        return new Response(
          JSON.stringify({
            data: {
              projectCreate: {
                success: true,
                project: {
                  id: PROJECT_ID,
                  name: "Demo App",
                  url: "https://linear.app/didi-build/project/demo",
                  description: "new",
                },
              },
            },
          }),
        );
      }
      if (q.includes("EntityExternalLinkCreate")) {
        return new Response(
          JSON.stringify({ data: { entityExternalLinkCreate: { success: true } } }),
        );
      }
      if (q.includes("IssueCreate")) {
        return new Response(
          JSON.stringify({
            data: {
              issueCreate: {
                success: true,
                issue: {
                  id: KICKOFF_ID,
                  identifier: "DIDI-900",
                  title: "Demo App: kickoff",
                  url: "https://linear.app/didi-build/issue/DIDI-900",
                  state: { id: STATE_ID, name: "Ready for CTO breakdown" },
                },
              },
            },
          }),
        );
      }
      if (q.includes("IssueRelationCreate")) {
        return new Response(
          JSON.stringify({ data: { issueRelationCreate: { success: true } } }),
        );
      }
      if (q.includes("CommentCreate")) {
        return new Response(
          JSON.stringify({
            data: { commentCreate: { success: true, comment: { id: "c1" } } },
          }),
        );
      }
      if (q.includes("IssueUpdate")) {
        return new Response(
          JSON.stringify({ data: { issueUpdate: { success: true } } }),
        );
      }
      return new Response(JSON.stringify({ errors: [{ message: "unmocked" }] }), {
        status: 500,
      });
    },
  });
}

export function mutationCalls(calls: GraphqlCall[]): GraphqlCall[] {
  return calls.filter((c) => /^\s*mutation\b/im.test(c.query));
}

/** Mutations that change Linear state (excludes factory run comments). */
export function resourceMutationCalls(calls: GraphqlCall[]): GraphqlCall[] {
  return mutationCalls(calls).filter((c) => !c.query.includes("CommentCreate"));
}
