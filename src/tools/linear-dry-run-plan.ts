import type { ProjectFactoryEnv } from "../env.js";
import {
  KICKOFF_WORKFLOW_STATE_NAME,
  REPO_PROJECT_LABEL_GROUP_NAME,
  linearRepoProjectLabelName,
} from "../factory/linear-constants.js";
import {
  factoryKickoffEpicMarker,
  kickoffEpicTitle,
  projectHasFactoryMarker,
} from "../factory/linear-content.js";
import { LinearClient } from "../linear/client.js";
import { detectRepoLabelConflict, selectFactoryProject } from "../linear/ownership.js";
import {
  findIssueByIdentifier,
  findKickoffEpicByMarker,
  findProjects,
  findWorkflowStateId,
  listProjectLabels,
  resolveLinearTeamId,
  teamScopedProjectNameFilter,
  type LinearProjectNode,
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
  idea_issue_found?: boolean | null;
  conflict?: string;
};

export type CreateLinearProjectDryRunPlan = {
  status: "planned" | "conflict";
  dry_run: true;
  steps: FactoryStep[];
  warnings: string[];
  project_url: string | null;
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
    projectDescription: string;
  },
  deps?: { fetchImpl?: typeof fetch; linear?: LinearClient },
): Promise<CreateLinearProjectDryRunPlan> {
  const projectLabel = linearRepoProjectLabelName(input.org, input.name);
  const kickoffTitle = kickoffEpicTitle(input.displayName);
  const repoUrl = `https://github.com/${input.org}/${input.name}`;
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];
  let planStatus: "planned" | "conflict" = "planned";

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
    detail: `${kickoffTitle} with epic marker in ${KICKOFF_WORKFLOW_STATE_NAME}`,
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
    idea_issue_found: null,
  };

  let kickoffEpic: { identifier: string; url: string } | null = null;
  let projectUrl: string | null = null;

  if (!env.PROJECT_FACTORY_LINEAR_API_KEY) {
    warnings.push("PROJECT_FACTORY_LINEAR_API_KEY not set; skipped Linear reads");
    return {
      status: planStatus,
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

  const teamResult = await resolveLinearTeamId(linear, env.PROJECT_FACTORY_LINEAR_TEAM);
  if (!teamResult.ok) {
    linearDiscovery.linear_error = teamResult.error.error.message;
    warnings.push(`Linear team read failed: ${teamResult.error.error.message}`);
    steps.push({
      id: "read_linear_team",
      status: "failed",
      detail: teamResult.error.error.message,
    });
    return {
      status: planStatus,
      dry_run: true,
      steps,
      warnings,
      project_url: projectUrl,
      project_label: projectLabel,
      kickoff_epic: kickoffEpic,
      linear: linearDiscovery,
    };
  }
  const teamId = teamResult.teamId;
  steps.push({
    id: "read_linear_team",
    status: "done",
    detail: env.PROJECT_FACTORY_LINEAR_TEAM,
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
      status: planStatus,
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

  if (group) {
    const labelsByName = await listProjectLabels(linear, {
      name: { eq: projectLabel },
    });
    if (!labelsByName.ok) {
      warnings.push(
        `Linear project label read by name failed: ${labelsByName.error.error.message}`,
      );
      steps.push({
        id: "read_project_label_by_name",
        status: "failed",
        detail: labelsByName.error.error.message,
      });
    } else {
      const labelConflict = detectRepoLabelConflict(
        labelsByName.labels,
        projectLabel,
        group.id,
      );
      if (labelConflict) {
        planStatus = "conflict";
        linearDiscovery.conflict = labelConflict.message;
        steps.push({
          id: "repo_project_label",
          status: "failed",
          detail: labelConflict.message,
        });
      }
    }
  }

  linearDiscovery.repo_label_exists = Boolean(repoLabel);
  if (repoLabel) {
    linearDiscovery.repo_label_id = repoLabel.id;
  }

  let projectId: string | undefined;

  const applyProjectPick = (
    project: LinearProjectNode | undefined,
    conflict: ReturnType<typeof selectFactoryProject>["conflict"],
    step: "read_project_by_label" | "read_project_by_name",
    detail: string,
  ) => {
    if (conflict) {
      planStatus = "conflict";
      linearDiscovery.conflict = conflict.message;
      steps.push({ id: step, status: "failed", detail: conflict.message });
      return;
    }
    if (project) {
      projectId = project.id;
      projectUrl = project.url;
      linearDiscovery.project_exists = true;
      linearDiscovery.factory_owned = projectHasFactoryMarker(
        project.description,
        input.name,
      );
      steps.push({ id: step, status: "done", detail: project.name });
      return;
    }
    steps.push({ id: step, status: "done", detail: detail });
  };

  if (planStatus !== "conflict" && repoLabel) {
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
    } else {
      const pick = selectFactoryProject(
        byLabel.projects,
        input.name,
        "read_project_by_label",
      );
      if (!pick.project && !pick.conflict) {
        linearDiscovery.project_exists = false;
      }
      applyProjectPick(pick.project, pick.conflict, "read_project_by_label", "none");
    }
  }

  if (planStatus !== "conflict" && !projectId) {
    const byName = await findProjects(
      linear,
      teamScopedProjectNameFilter(teamId, input.displayName),
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
    } else {
      const pick = selectFactoryProject(
        byName.projects,
        input.name,
        "read_project_by_name",
      );
      if (!pick.project && !pick.conflict) {
        linearDiscovery.project_exists = false;
      }
      applyProjectPick(pick.project, pick.conflict, "read_project_by_name", "none");
    }
  }

  if (projectId) {
    const marker = factoryKickoffEpicMarker(projectId);
    const kickoff = await findKickoffEpicByMarker(linear, projectId, marker);
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
    teamId,
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
    status: planStatus,
    dry_run: true,
    steps,
    warnings,
    project_url: projectUrl,
    project_label: projectLabel,
    kickoff_epic: kickoffEpic,
    linear: linearDiscovery,
  };
}
