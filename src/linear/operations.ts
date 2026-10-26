import type { LinearClient } from "./client.js";
import { mapLinearFailure } from "./linear-errors.js";
import type { FactoryError } from "../tools/types.js";

export type ProjectLabelNode = {
  id: string;
  name: string;
  isGroup?: boolean;
  parent?: { id: string; name: string } | null;
};

export type LinearProjectNode = {
  id: string;
  name: string;
  url: string;
  description?: string | null;
  labels?: { nodes: { id: string; name: string }[] };
  externalLinks?: { nodes: { id: string; url: string; label: string }[] };
};

export type LinearIssueNode = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  state?: { id: string; name: string };
  relations?: {
    nodes: { type: string; relatedIssue?: { id: string; identifier: string } | null }[];
  };
};

const PROJECT_LABELS_QUERY = `
query ProjectLabels($filter: ProjectLabelFilter) {
  projectLabels(filter: $filter, first: 50) {
    nodes {
      id
      name
      isGroup
      parent { id name }
    }
  }
}`;

const PROJECTS_BY_LABEL_QUERY = `
query ProjectsByLabel($filter: ProjectFilter) {
  projects(filter: $filter, first: 10) {
    nodes {
      id
      name
      url
      description
      labels { nodes { id name } }
      externalLinks { nodes { id url label } }
    }
  }
}`;

const PROJECTS_BY_NAME_QUERY = `
query ProjectsByName($filter: ProjectFilter) {
  projects(filter: $filter, first: 10) {
    nodes {
      id
      name
      url
      description
      labels { nodes { id name } }
      externalLinks { nodes { id url label } }
    }
  }
}`;

const WORKFLOW_STATES_QUERY = `
query WorkflowStates($filter: WorkflowStateFilter) {
  workflowStates(filter: $filter, first: 20) {
    nodes { id name }
  }
}`;

const ISSUES_IN_PROJECT_QUERY = `
query IssuesInProject($filter: IssueFilter) {
  issues(filter: $filter, first: 10) {
    nodes {
      id
      identifier
      title
      url
      description
      state { id name }
      relations {
        nodes {
          type
          relatedIssue { id identifier }
        }
      }
    }
  }
}`;

const ISSUE_BY_ID_QUERY = `
query IssueById($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    url
    state { id name }
  }
}`;

export async function listProjectLabels(
  linear: LinearClient,
  filter: Record<string, unknown>,
): Promise<
  | { ok: true; labels: ProjectLabelNode[] }
  | { ok: false; error: FactoryError; step: string }
> {
  const result = await linear.request<{ projectLabels: { nodes: ProjectLabelNode[] } }>(
    PROJECT_LABELS_QUERY,
    { filter },
  );
  if (!result.ok) {
    const mapped = mapLinearFailure(result.error, "read_project_labels");
    return { ok: false, error: mapped, step: "read_project_labels" };
  }
  return { ok: true, labels: result.data.projectLabels.nodes };
}

export async function findProjects(
  linear: LinearClient,
  filter: Record<string, unknown>,
  step: string,
): Promise<
  | { ok: true; projects: LinearProjectNode[] }
  | { ok: false; error: FactoryError; step: string }
> {
  const query = filter.labels ? PROJECTS_BY_LABEL_QUERY : PROJECTS_BY_NAME_QUERY;
  const result = await linear.request<{ projects: { nodes: LinearProjectNode[] } }>(
    query,
    {
      filter,
    },
  );
  if (!result.ok) {
    const mapped = mapLinearFailure(result.error, step);
    return { ok: false, error: mapped, step };
  }
  return { ok: true, projects: result.data.projects.nodes };
}

export async function findWorkflowStateId(
  linear: LinearClient,
  teamId: string,
  name: string,
): Promise<
  { ok: true; stateId: string } | { ok: false; error: FactoryError; step: string }
> {
  const result = await linear.request<{
    workflowStates: { nodes: { id: string; name: string }[] };
  }>(WORKFLOW_STATES_QUERY, {
    filter: {
      team: { id: { eq: teamId } },
      name: { eq: name },
    },
  });
  if (!result.ok) {
    const mapped = mapLinearFailure(result.error, "read_workflow_state");
    return { ok: false, error: mapped, step: "read_workflow_state" };
  }
  const state = result.data.workflowStates.nodes[0];
  if (!state) {
    return {
      ok: false,
      error: {
        error: {
          code: "upstream_error",
          message: `workflow state not found: ${name}`,
          step: "read_workflow_state",
        },
      },
      step: "read_workflow_state",
    };
  }
  return { ok: true, stateId: state.id };
}

export async function findKickoffIssues(
  linear: LinearClient,
  projectId: string,
  title: string,
): Promise<
  | { ok: true; issues: LinearIssueNode[] }
  | { ok: false; error: FactoryError; step: string }
> {
  const result = await linear.request<{ issues: { nodes: LinearIssueNode[] } }>(
    ISSUES_IN_PROJECT_QUERY,
    {
      filter: {
        project: { id: { eq: projectId } },
        title: { eq: title },
      },
    },
  );
  if (!result.ok) {
    const mapped = mapLinearFailure(result.error, "read_kickoff_epic");
    return { ok: false, error: mapped, step: "read_kickoff_epic" };
  }
  return { ok: true, issues: result.data.issues.nodes };
}

export async function findIssueByIdentifier(
  linear: LinearClient,
  identifier: string,
): Promise<
  | { ok: true; issue: LinearIssueNode | null }
  | { ok: false; error: FactoryError; step: string }
> {
  const result = await linear.request<{ issue: LinearIssueNode | null }>(
    ISSUE_BY_ID_QUERY,
    {
      id: identifier,
    },
  );
  if (!result.ok) {
    const mapped = mapLinearFailure(result.error, "read_idea_issue");
    return { ok: false, error: mapped, step: "read_idea_issue" };
  }
  return { ok: true, issue: result.data.issue };
}

export const PROJECT_LABEL_CREATE_MUTATION = `
mutation ProjectLabelCreate($input: ProjectLabelCreateInput!) {
  projectLabelCreate(input: $input) {
    success
    projectLabel { id name }
  }
}`;

export const PROJECT_CREATE_MUTATION = `
mutation ProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    success
    project { id name url description }
  }
}`;

export const PROJECT_UPDATE_MUTATION = `
mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) {
    success
    project { id name url description }
  }
}`;

export const ENTITY_EXTERNAL_LINK_CREATE_MUTATION = `
mutation EntityExternalLinkCreate($input: EntityExternalLinkCreateInput!) {
  entityExternalLinkCreate(input: $input) {
    success
    entityExternalLink { id url label }
  }
}`;

export const ISSUE_CREATE_MUTATION = `
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url state { id name } }
  }
}`;

export const ISSUE_UPDATE_MUTATION = `
mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id identifier title url state { id name } }
  }
}`;

export const ISSUE_RELATION_CREATE_MUTATION = `
mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) {
    success
    issueRelation { id type }
  }
}`;
