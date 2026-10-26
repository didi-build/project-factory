import type { ProjectFactoryEnv } from "../env.js";
import {
  DIDI_BUILD_LINEAR_TEAM_ID,
  KICKOFF_WORKFLOW_STATE_NAME,
  REPO_PROJECT_LABEL_GROUP_NAME,
  linearRepoProjectLabelName,
} from "../factory/linear-constants.js";
import {
  kickoffEpicTitle,
  projectHasFactoryMarker,
} from "../factory/linear-content.js";
import { LinearClient } from "../linear/client.js";
import {
  findIssueByIdentifier,
  findKickoffIssues,
  findProjects,
  findWorkflowStateId,
  listProjectLabels,
} from "../linear/operations.js";
import type { FactoryStep } from "./types.js";

export type LinearDryRunDiscovery = {
  linear_read_ok: boolean;
  linear_error?: string;
  repo_label_group_id?: string;
  repo_label_id?: string | null;
  repo_label_exists?: boolean | null;
  project_exists?: boolean | null;
  factory_owned?: boolean | null;
  kickoff_epic_exists?: boolean | null;
  kickoff_state_ok?: boolean | null;
  idea_issue_found?: boolean | null;
};

export type CreateLinearProjectDryRunPlan = {
  status: "planned";
  dry_run: true;
  steps: FactoryStep[];
  warnings: string[];
  project_url: string;
  project_label: string;
  kickoff_epic: { identifier: string; url: string } | null;
  linear: LinearDryRunDiscovery;
};

export async function buildCreateLinearProjectDryRunPlan(
  env: ProjectFactoryEnv,
  input: {
    name: string;
    displayName: string;
    summary: string;
    org: string;
    ideaIssue?: string;
  },
  deps?: { fetchImpl?: typeof fetch; linear?: LinearClient },
): Promise<CreateLinearProjectDryRunPlan> {
  const projectLabel = linearRepoProjectLabelName(input.org, input.name);
  const kickoffTitle = kickoffEpicTitle(input.displayName);
  const repoUrl = `https://github.com/${input.org}/${input.name}`;
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];

  steps.push({
    id: "repo_project_label",
    status: "planned",
    detail: `${REPO_PROJECT_LABEL_GROUP_NAME}: ${projectLabel}`,
  });
  steps.push({
    id: "linear_project",
    status: "planned",
    detail: `${input.displayName} with label ${projectLabel}`,
  });
  steps.push({
    id: "github_link",
    status: "planned",
    detail: repoUrl,
  });
  steps.push({
    id: "kickoff_epic",
    status: "planned",
    detail: `${kickoffTitle} in ${KICKOFF_WORKFLOW_STATE_NAME}`,
  });
  if (input.ideaIssue) {
    steps.push({
      id: "idea_issue_relation",
      status: "planned",
      detail: `related to ${input.ideaIssue}`,
    });
  }

  const linearDiscovery: LinearDryRunDiscovery = {
    linear_read_ok: false,
    repo_label_exists: null,
    project_exists: null,
    factory_owned: null,
    kickoff_epic_exists: null,
    kickoff_state_ok: null,
    idea_issue_found: null,
  };

  let kickoffEpic: { identifier: string; url: string } | null = null;
  let projectUrl = `https://linear.app/didi-build/project/planned-${input.name}`;

  if (!env.PROJECT_FACTORY_LINEAR_API_KEY) {
    warnings.push("PROJECT_FACTORY_LINEAR_API_KEY not set; skipped Linear reads");
    return {
      status: "planned",
      dry_run: true,
      steps,
      warnings,
      project_url: projectUrl,
      project_label: projectLabel,
      kickoff_epic: kickoffEpic,
      linear: linearDiscovery,
    };
  }

  const linear =
    deps?.linear ??
    new LinearClient({
      apiKey: env.PROJECT_FACTORY_LINEAR_API_KEY,
      fetchImpl: deps?.fetchImpl,
    });

  const labelsResult = await listProjectLabels(linear, {
    name: { in: [REPO_PROJECT_LABEL_GROUP_NAME, projectLabel] },
  });
  if (!labelsResult.ok) {
    linearDiscovery.linear_error = labelsResult.error.error.message;
    warnings.push(
      `Linear project label read failed: ${labelsResult.error.error.message}`,
    );
    steps.push({
      id: "read_project_labels",
      status: "failed",
      detail: labelsResult.error.error.message,
    });
    return {
      status: "planned",
      dry_run: true,
      steps,
      warnings,
      project_url: projectUrl,
      project_label: projectLabel,
      kickoff_epic: kickoffEpic,
      linear: linearDiscovery,
    };
  }

  linearDiscovery.linear_read_ok = true;
  steps.push({ id: "read_project_labels", status: "done" });

  const group = labelsResult.labels.find(
    (l) => l.isGroup && l.name === REPO_PROJECT_LABEL_GROUP_NAME,
  );
  const repoLabel = labelsResult.labels.find(
    (l) => !l.isGroup && l.name === projectLabel,
  );
  if (group) {
    linearDiscovery.repo_label_group_id = group.id;
  } else {
    warnings.push(
      `repo project label group "${REPO_PROJECT_LABEL_GROUP_NAME}" not found`,
    );
  }
  linearDiscovery.repo_label_exists = Boolean(repoLabel);
  if (repoLabel) {
    linearDiscovery.repo_label_id = repoLabel.id;
  }

  let projectId: string | undefined;
  if (repoLabel) {
    const byLabel = await findProjects(
      linear,
      { labels: { id: { eq: repoLabel.id } } },
      "read_project_by_label",
    );
    if (!byLabel.ok) {
      warnings.push(
        `Linear project read by label failed: ${byLabel.error.error.message}`,
      );
      steps.push({
        id: "read_project_by_label",
        status: "failed",
        detail: byLabel.error.error.message,
      });
    } else if (byLabel.projects[0]) {
      const project = byLabel.projects[0];
      projectId = project.id;
      projectUrl = project.url;
      linearDiscovery.project_exists = true;
      linearDiscovery.factory_owned = projectHasFactoryMarker(
        project.description,
        input.name,
      );
      steps.push({ id: "read_project_by_label", status: "done", detail: project.name });
    } else {
      linearDiscovery.project_exists = false;
      steps.push({ id: "read_project_by_label", status: "done", detail: "none" });
    }
  } else {
    const byName = await findProjects(
      linear,
      { name: { eq: input.displayName } },
      "read_project_by_name",
    );
    if (!byName.ok) {
      warnings.push(
        `Linear project read by name failed: ${byName.error.error.message}`,
      );
      steps.push({
        id: "read_project_by_name",
        status: "failed",
        detail: byName.error.error.message,
      });
    } else if (byName.projects[0]) {
      const project = byName.projects[0];
      projectId = project.id;
      projectUrl = project.url;
      linearDiscovery.project_exists = true;
      linearDiscovery.factory_owned = projectHasFactoryMarker(
        project.description,
        input.name,
      );
      steps.push({ id: "read_project_by_name", status: "done", detail: project.name });
    } else {
      linearDiscovery.project_exists = false;
      steps.push({ id: "read_project_by_name", status: "done", detail: "none" });
    }
  }

  if (projectId) {
    const kickoff = await findKickoffIssues(linear, projectId, kickoffTitle);
    if (!kickoff.ok) {
      warnings.push(`Linear kickoff epic read failed: ${kickoff.error.error.message}`);
      steps.push({
        id: "read_kickoff_epic",
        status: "failed",
        detail: kickoff.error.error.message,
      });
    } else if (kickoff.issues[0]) {
      linearDiscovery.kickoff_epic_exists = true;
      kickoffEpic = {
        identifier: kickoff.issues[0].identifier,
        url: kickoff.issues[0].url,
      };
      linearDiscovery.kickoff_state_ok =
        kickoff.issues[0].state?.name === KICKOFF_WORKFLOW_STATE_NAME;
      steps.push({
        id: "read_kickoff_epic",
        status: "done",
        detail: kickoff.issues[0].identifier,
      });
    } else {
      linearDiscovery.kickoff_epic_exists = false;
      steps.push({ id: "read_kickoff_epic", status: "done", detail: "none" });
    }
  }

  const stateResult = await findWorkflowStateId(
    linear,
    DIDI_BUILD_LINEAR_TEAM_ID,
    KICKOFF_WORKFLOW_STATE_NAME,
  );
  if (!stateResult.ok) {
    warnings.push(
      `Linear workflow state read failed: ${stateResult.error.error.message}`,
    );
    steps.push({
      id: "read_workflow_state",
      status: "failed",
      detail: stateResult.error.error.message,
    });
  } else {
    steps.push({
      id: "read_workflow_state",
      status: "done",
      detail: KICKOFF_WORKFLOW_STATE_NAME,
    });
  }

  if (input.ideaIssue) {
    const idea = await findIssueByIdentifier(linear, input.ideaIssue);
    if (!idea.ok) {
      warnings.push(`Linear idea issue read failed: ${idea.error.error.message}`);
      steps.push({
        id: "read_idea_issue",
        status: "failed",
        detail: idea.error.error.message,
      });
    } else {
      linearDiscovery.idea_issue_found = Boolean(idea.issue);
      steps.push({
        id: "read_idea_issue",
        status: "done",
        detail: idea.issue?.identifier ?? "not found",
      });
    }
  }

  return {
    status: "planned",
    dry_run: true,
    steps,
    warnings,
    project_url: projectUrl,
    project_label: projectLabel,
    kickoff_epic: kickoffEpic,
    linear: linearDiscovery,
  };
}
