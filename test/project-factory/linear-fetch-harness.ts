import { LinearClient } from "../../src/linear/client.js";
import { buildLinearApiKey } from "./linear-mock.js";

export type GraphqlCall = {
  query: string;
  variables?: unknown;
};

export type HarnessProjectNode = {
  id: string;
  name: string;
  url: string;
  description: string;
  factoryMarker: boolean;
};

export type HarnessState = {
  teamId?: string;
  labelExists?: boolean;
  labelOutsideRepoGroup?: boolean;
  /** @deprecated use projectsByLabelNodes / projectsByNameNodes */
  projectExists?: boolean;
  factoryMarker?: boolean;
  projectsByLabelNodes?: HarnessProjectNode[];
  projectsByNameNodes?: HarnessProjectNode[];
  kickoffExists?: boolean;
  /** Return two kickoff issues with the same epic marker. */
  kickoffDuplicateMarkers?: boolean;
  kickoffStateId?: string;
  ideaIssue?: boolean;
  ideaHasRelationToKickoff?: boolean;
  ideaRelationType?: string;
  failMutation?: string;
  /** When set, queries containing this substring return HTTP 502. */
  failRead?: string;
  /** When set, queries containing this substring return HTTP 200 with a GraphQL errors array. */
  failGraphql200ErrorsOn?: string;
};

export const LINEAR_RAW_GRAPHQL_200_LEAK_MARKER =
  "LINEAR_RAW_GRAPHQL_200_DO_NOT_LEAK_88421";

const LABEL_ID = "label-demo-uuid";
const PROJECT_ID = "project-demo-uuid";

function toApiProject(node: HarnessProjectNode, labelId: string) {
  return {
    id: node.id,
    name: node.name,
    url: node.url,
    description: node.description,
    labels: { nodes: [{ id: labelId, name: "didi-build/demo-app" }] },
    externalLinks: {
      nodes: node.factoryMarker
        ? [
            {
              id: "link-1",
              url: "https://github.com/didi-build/demo-app",
              label: "GitHub",
            },
          ]
        : [],
    },
  };
}

export function defaultHarnessProject(factoryMarker: boolean): HarnessProjectNode {
  return {
    id: PROJECT_ID,
    name: "Demo App",
    url: "https://linear.app/didi-build/project/demo",
    description: factoryMarker
      ? "A demo\n\nGitHub: https://github.com/didi-build/demo-app\n\n<!-- project-factory:demo-app -->"
      : "foreign",
    factoryMarker,
  };
}

function resolveProjectNodes(
  state: HarnessState,
  byLabel: boolean,
): HarnessProjectNode[] {
  if (byLabel && state.projectsByLabelNodes !== undefined) {
    return state.projectsByLabelNodes;
  }
  if (!byLabel && state.projectsByNameNodes !== undefined) {
    return state.projectsByNameNodes;
  }
  if (state.projectExists) {
    const marker = state.factoryMarker ?? true;
    return [defaultHarnessProject(marker)];
  }
  return [];
}

export function createHarnessClient(
  state: HarnessState,
  calls: GraphqlCall[] = [],
): LinearClient {
  const TEAM_ID = state.teamId ?? "cff86df5-36a6-4c6a-8527-7ef0bee09c1e";
  const REPO_GROUP_ID = "group-repo-uuid";
  const STATE_ID = state.kickoffStateId ?? "state-cto-uuid";
  const KICKOFF_ID = "kickoff-uuid";
  const IDEA_ID = "idea-uuid";

  return new LinearClient({
    apiKey: buildLinearApiKey(),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as GraphqlCall;
      calls.push(body);
      const q = body.query;

      if (state.failGraphql200ErrorsOn && q.includes(state.failGraphql200ErrorsOn)) {
        return new Response(
          JSON.stringify({
            errors: [
              {
                message: LINEAR_RAW_GRAPHQL_200_LEAK_MARKER,
                extensions: { code: "INTERNAL_ERROR" },
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (state.failRead && q.includes(state.failRead)) {
        return new Response(
          JSON.stringify({
            errors: [
              {
                message: "LINEAR_RAW_UPSTREAM_DO_NOT_LEAK_99441",
                extensions: { code: "INTERNAL_ERROR" },
              },
            ],
          }),
          { status: 502 },
        );
      }

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
      if (q.includes("ProjectsByLabel")) {
        const nodes = resolveProjectNodes(state, true).map((p) =>
          toApiProject(p, LABEL_ID),
        );
        return new Response(JSON.stringify({ data: { projects: { nodes } } }));
      }
      if (q.includes("ProjectsByName")) {
        const nodes = resolveProjectNodes(state, false).map((p) =>
          toApiProject(p, LABEL_ID),
        );
        return new Response(JSON.stringify({ data: { projects: { nodes } } }));
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
        if (state.kickoffDuplicateMarkers) {
          const marker = `<!-- project-factory:epic:${PROJECT_ID} -->`;
          return new Response(
            JSON.stringify({
              data: {
                issues: {
                  nodes: [
                    {
                      id: KICKOFF_ID,
                      identifier: "DIDI-900",
                      title: "Kickoff A",
                      url: "https://linear.app/didi-build/issue/DIDI-900",
                      description: marker,
                      state: { id: STATE_ID, name: "Ready for CTO breakdown" },
                      relations: { nodes: [] },
                    },
                    {
                      id: "kickoff-dup-uuid",
                      identifier: "DIDI-901",
                      title: "Kickoff B",
                      url: "https://linear.app/didi-build/issue/DIDI-901",
                      description: marker,
                      state: { id: STATE_ID, name: "Ready for CTO breakdown" },
                      relations: { nodes: [] },
                    },
                  ],
                },
              },
            }),
          );
        }
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
          const relationType = state.ideaRelationType ?? "related";
          const relations = state.ideaHasRelationToKickoff
            ? [
                {
                  type: relationType,
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
