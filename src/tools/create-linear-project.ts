import type { ProjectFactoryEnv } from "../env.js";
import { writeAuditEntry } from "../factory/audit.js";
import {
  KICKOFF_WORKFLOW_STATE_NAME,
  REPO_PROJECT_LABEL_GROUP_NAME,
  linearRepoProjectLabelName,
} from "../factory/linear-constants.js";
import {
  buildKickoffEpicDescription,
  factoryKickoffEpicMarker,
  githubRepoUrl,
  kickoffEpicTitle,
  projectHasFactoryMarker,
  validateProjectDescriptionLength,
} from "../factory/linear-content.js";
import { LinearClient } from "../linear/client.js";
import { mapLinearFailure } from "../linear/linear-errors.js";
import {
  detectForeignProjectConflict,
  detectRepoLabelConflict,
} from "../linear/ownership.js";
import {
  COMMENT_CREATE_MUTATION,
  ENTITY_EXTERNAL_LINK_CREATE_MUTATION,
  ISSUE_CREATE_MUTATION,
  ISSUE_RELATION_CREATE_MUTATION,
  PROJECT_CREATE_MUTATION,
  PROJECT_LABEL_CREATE_MUTATION,
  PROJECT_UPDATE_MUTATION,
  findIssueByIdentifier,
  findKickoffEpicByMarker,
  findProjects,
  findWorkflowStateId,
  listProjectLabels,
  resolveLinearTeamId,
  teamScopedProjectNameFilter,
  type LinearIssueNode,
  type LinearProjectNode,
} from "../linear/operations.js";
import { kickoffLinkedToIdea } from "../linear/relations.js";
import { buildFactoryRunCommentBody } from "../linear/run-comment.js";
import { validateProjectName } from "../factory/naming.js";
import {
  buildCreateLinearProjectDryRunPlan,
  type CreateLinearProjectDryRunPlan,
} from "./linear-dry-run-plan.js";
import type { FactoryError, FactoryStep, FactorySuccess } from "./types.js";

export type CreateLinearProjectInput = {
  name: string;
  display_name: string;
  summary: string;
  idea_issue?: string;
  approval_ref: string;
  dry_run?: boolean;
};

export type CreateLinearProjectContext = {
  env: ProjectFactoryEnv;
  requestId: string;
  caller: string;
  linear?: LinearClient;
  fetchImpl?: typeof fetch;
};

function factoryError(
  code: string,
  message: string,
  step?: string,
  retryable = false,
): FactoryError {
  return { error: { code, message, step, retryable } };
}

export async function createLinearProject(
  ctx: CreateLinearProjectContext,
  input: CreateLinearProjectInput,
): Promise<FactorySuccess | FactoryError> {
  const started = Date.now();
  const dryRun = input.dry_run !== false;
  const summary = input.summary.trim();
  const displayName = input.display_name.trim();
  const ideaIssue = input.idea_issue?.trim();
  const approvalRef = input.approval_ref?.trim() ?? "";
  const steps: FactoryStep[] = [];
  const warnings: string[] = [];
  let auditStatus = "started";
  let failedStep: string | undefined;
  let auditExtras: { steps?: FactoryStep[] } = {};
  let auditResources: { project_url?: string; kickoff_epic_url?: string } = {};
  const org = ctx.env.PROJECT_FACTORY_GH_ORG;
  const projectLabelName = linearRepoProjectLabelName(org, input.name);
  const kickoffTitle = kickoffEpicTitle(displayName);
  const repoUrl = githubRepoUrl(org, input.name);
  let linearClient: LinearClient | undefined;
  let kickoffForComment: LinearIssueNode | undefined;

  const finishAudit = () => {
    writeAuditEntry({
      request_id: ctx.requestId,
      caller: ctx.caller,
      tool: "create_linear_project",
      dry_run: dryRun,
      input: {
        name: input.name,
        display_name: displayName,
        summary,
        idea_issue: ideaIssue,
        approval_ref: approvalRef,
      },
      approval_ref: approvalRef,
      status: auditStatus,
      resources: {
        project_url: auditResources.project_url,
        kickoff_epic_url: auditResources.kickoff_epic_url,
        project_label: projectLabelName,
      },
      duration_ms: Date.now() - started,
      steps: auditExtras.steps ?? (steps.length > 0 ? [...steps] : undefined),
      failed_step: failedStep,
    });
  };

  try {
    const nameCheck = validateProjectName(input.name);
    if (!nameCheck.ok) {
      auditStatus = nameCheck.code;
      return factoryError(nameCheck.code, nameCheck.message);
    }
    if (!summary) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", "summary is required");
    }
    if (!displayName) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", "display_name is required");
    }
    if (!approvalRef) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", "approval_ref is required");
    }

    const descriptionCheck = validateProjectDescriptionLength({
      summary,
      name: input.name,
      org,
    });
    if (!descriptionCheck.ok) {
      auditStatus = "invalid_input";
      return factoryError("invalid_input", descriptionCheck.message);
    }
    const projectDescription = descriptionCheck.description;

    if (dryRun) {
      const plan = await buildCreateLinearProjectDryRunPlan(
        ctx.env,
        {
          name: input.name,
          displayName,
          summary,
          org,
          ideaIssue,
          projectDescription,
        },
        { fetchImpl: ctx.fetchImpl, linear: ctx.linear },
      );
      auditStatus = plan.status;
      auditExtras = { steps: plan.steps };
      return {
        request_id: ctx.requestId,
        ...plan,
      } as FactorySuccess & CreateLinearProjectDryRunPlan;
    }

    if (!ctx.env.PROJECT_FACTORY_LINEAR_API_KEY) {
      auditStatus = "missing_secret";
      return factoryError("missing_secret", "PROJECT_FACTORY_LINEAR_API_KEY");
    }

    linearClient =
      ctx.linear ??
      new LinearClient({
        apiKey: ctx.env.PROJECT_FACTORY_LINEAR_API_KEY,
        fetchImpl: ctx.fetchImpl,
      });

    const teamResult = await resolveLinearTeamId(
      linearClient,
      ctx.env.PROJECT_FACTORY_LINEAR_TEAM,
    );
    if (!teamResult.ok) {
      auditStatus = teamResult.error.error.code;
      failedStep = teamResult.step;
      return teamResult.error;
    }
    const teamId = teamResult.teamId;

    const labelsRead = await listProjectLabels(linearClient, {
      name: { in: [REPO_PROJECT_LABEL_GROUP_NAME, projectLabelName] },
    });
    if (!labelsRead.ok) {
      auditStatus = labelsRead.error.error.code;
      failedStep = labelsRead.step;
      return labelsRead.error;
    }

    const repoGroup = labelsRead.labels.find(
      (l) => l.isGroup && l.name === REPO_PROJECT_LABEL_GROUP_NAME,
    );
    if (!repoGroup) {
      auditStatus = "upstream_error";
      failedStep = "read_project_labels";
      return factoryError(
        "upstream_error",
        `project label group ${REPO_PROJECT_LABEL_GROUP_NAME} not found`,
        "read_project_labels",
      );
    }

    const labelsByName = await listProjectLabels(linearClient, {
      name: { eq: projectLabelName },
    });
    if (!labelsByName.ok) {
      auditStatus = labelsByName.error.error.code;
      failedStep = labelsByName.step;
      return labelsByName.error;
    }
    const labelConflict = detectRepoLabelConflict(
      labelsByName.labels,
      projectLabelName,
      repoGroup.id,
    );
    if (labelConflict) {
      auditStatus = labelConflict.code;
      failedStep = labelConflict.step;
      return factoryError(
        labelConflict.code,
        labelConflict.message,
        labelConflict.step,
      );
    }

    let repoLabel = labelsRead.labels.find(
      (l) => !l.isGroup && l.name === projectLabelName,
    );
    let repoLabelCreated = false;
    if (!repoLabel) {
      const createLabel = await linearClient.request<{
        projectLabelCreate: {
          success: boolean;
          projectLabel?: { id: string; name: string };
        };
      }>(PROJECT_LABEL_CREATE_MUTATION, {
        input: {
          name: projectLabelName,
          parentId: repoGroup.id,
        },
      });
      if (!createLabel.ok) {
        const mapped = mapLinearFailure(createLabel.error, "repo_project_label");
        auditStatus = mapped.error.code;
        failedStep = "repo_project_label";
        return mapped;
      }
      if (
        !createLabel.data.projectLabelCreate.success ||
        !createLabel.data.projectLabelCreate.projectLabel
      ) {
        auditStatus = "upstream_error";
        failedStep = "repo_project_label";
        return factoryError(
          "upstream_error",
          "projectLabelCreate failed",
          "repo_project_label",
        );
      }
      repoLabel = createLabel.data.projectLabelCreate.projectLabel;
      repoLabelCreated = true;
      steps.push({
        id: "repo_project_label",
        status: "done",
        detail: projectLabelName,
      });
    } else {
      steps.push({
        id: "repo_project_label",
        status: "skipped",
        detail: projectLabelName,
      });
    }

    let project: LinearProjectNode | undefined;
    let projectCreated = false;
    const byLabel = await findProjects(
      linearClient,
      { labels: { id: { eq: repoLabel.id } } },
      "read_project_by_label",
    );
    if (!byLabel.ok) {
      auditStatus = byLabel.error.error.code;
      failedStep = byLabel.step;
      return byLabel.error;
    }
    if (byLabel.projects[0]) {
      project = byLabel.projects[0];
      const conflict = detectForeignProjectConflict(
        project,
        input.name,
        "read_project_by_label",
      );
      if (conflict) {
        auditStatus = conflict.code;
        failedStep = conflict.step;
        return factoryError(conflict.code, conflict.message, conflict.step);
      }
    }

    if (!project) {
      const byName = await findProjects(
        linearClient,
        teamScopedProjectNameFilter(teamId, displayName),
        "read_project_by_name",
      );
      if (!byName.ok) {
        auditStatus = byName.error.error.code;
        failedStep = byName.step;
        return byName.error;
      }
      if (byName.projects[0]) {
        project = byName.projects[0];
        const conflict = detectForeignProjectConflict(
          project,
          input.name,
          "read_project_by_name",
        );
        if (conflict) {
          auditStatus = conflict.code;
          failedStep = conflict.step;
          return factoryError(conflict.code, conflict.message, conflict.step);
        }
      }
    }

    if (!project) {
      const createProject = await linearClient.request<{
        projectCreate: {
          success: boolean;
          project?: { id: string; name: string; url: string; description?: string };
        };
      }>(PROJECT_CREATE_MUTATION, {
        input: {
          name: displayName,
          teamIds: [teamId],
          description: projectDescription,
          labelIds: [repoLabel.id],
        },
      });
      if (!createProject.ok) {
        const mapped = mapLinearFailure(createProject.error, "linear_project");
        auditStatus = mapped.error.code;
        failedStep = "linear_project";
        return mapped;
      }
      if (
        !createProject.data.projectCreate.success ||
        !createProject.data.projectCreate.project
      ) {
        auditStatus = "upstream_error";
        failedStep = "linear_project";
        return factoryError("upstream_error", "projectCreate failed", "linear_project");
      }
      project = {
        ...createProject.data.projectCreate.project,
        labels: { nodes: [{ id: repoLabel.id, name: projectLabelName }] },
        externalLinks: { nodes: [] },
      };
      projectCreated = true;
      steps.push({ id: "linear_project", status: "done", detail: project.url });
    } else {
      steps.push({ id: "linear_project", status: "skipped", detail: project.url });
      const labelIds = project.labels?.nodes.map((l) => l.id) ?? [];
      const needsLabel = !labelIds.includes(repoLabel.id);
      const needsDescription =
        !project.description ||
        !projectHasFactoryMarker(project.description, input.name);
      if (needsLabel || needsDescription) {
        const updateDesc = validateProjectDescriptionLength({
          summary,
          name: input.name,
          org,
        });
        if (!updateDesc.ok) {
          auditStatus = "invalid_input";
          return factoryError("invalid_input", updateDesc.message);
        }
        const update = await linearClient.request<{
          projectUpdate: { success: boolean };
        }>(PROJECT_UPDATE_MUTATION, {
          id: project.id,
          input: {
            ...(needsLabel ? { labelIds: [...labelIds, repoLabel.id] } : {}),
            ...(needsDescription ? { description: updateDesc.description } : {}),
          },
        });
        if (!update.ok) {
          const mapped = mapLinearFailure(update.error, "linear_project");
          auditStatus = mapped.error.code;
          failedStep = "linear_project";
          return mapped;
        }
        steps.push({ id: "linear_project_repair", status: "done" });
      }
    }

    const links = project.externalLinks?.nodes ?? [];
    const hasGithubLink = links.some((l) => l.url === repoUrl);
    if (!hasGithubLink) {
      const linkCreate = await linearClient.request<{
        entityExternalLinkCreate: { success: boolean };
      }>(ENTITY_EXTERNAL_LINK_CREATE_MUTATION, {
        input: {
          projectId: project.id,
          url: repoUrl,
          label: "GitHub",
        },
      });
      if (!linkCreate.ok) {
        const mapped = mapLinearFailure(linkCreate.error, "github_link");
        auditStatus = mapped.error.code;
        failedStep = "github_link";
        return mapped;
      }
      steps.push({ id: "github_link", status: "done", detail: repoUrl });
    } else {
      steps.push({ id: "github_link", status: "skipped", detail: repoUrl });
    }

    const stateResult = await findWorkflowStateId(
      linearClient,
      teamId,
      KICKOFF_WORKFLOW_STATE_NAME,
    );
    if (!stateResult.ok) {
      auditStatus = stateResult.error.error.code;
      failedStep = stateResult.step;
      return stateResult.error;
    }

    let ideaIssueNode: LinearIssueNode | null = null;
    if (ideaIssue) {
      const ideaRead = await findIssueByIdentifier(linearClient, ideaIssue);
      if (!ideaRead.ok) {
        auditStatus = ideaRead.error.error.code;
        failedStep = ideaRead.step;
        return ideaRead.error;
      }
      if (!ideaRead.issue) {
        auditStatus = "upstream_error";
        failedStep = "read_idea_issue";
        return factoryError(
          "upstream_error",
          `idea issue not found: ${ideaIssue}`,
          "read_idea_issue",
        );
      }
      ideaIssueNode = ideaRead.issue;
    }

    const kickoffMarker = factoryKickoffEpicMarker(project.id);
    const kickoffRead = await findKickoffEpicByMarker(
      linearClient,
      project.id,
      kickoffMarker,
    );
    if (!kickoffRead.ok) {
      auditStatus = kickoffRead.error.error.code;
      failedStep = kickoffRead.step;
      return kickoffRead.error;
    }

    let kickoff = kickoffRead.issues[0];
    let kickoffCreated = false;
    const kickoffDescription = buildKickoffEpicDescription(project.id, summary);

    if (!kickoff) {
      const createIssue = await linearClient.request<{
        issueCreate: {
          success: boolean;
          issue?: LinearIssueNode;
        };
      }>(ISSUE_CREATE_MUTATION, {
        input: {
          teamId,
          projectId: project.id,
          title: kickoffTitle,
          description: kickoffDescription,
          stateId: stateResult.stateId,
        },
      });
      if (!createIssue.ok) {
        const mapped = mapLinearFailure(createIssue.error, "kickoff_epic");
        auditStatus = mapped.error.code;
        failedStep = "kickoff_epic";
        return mapped;
      }
      if (
        !createIssue.data.issueCreate.success ||
        !createIssue.data.issueCreate.issue
      ) {
        auditStatus = "upstream_error";
        failedStep = "kickoff_epic";
        return factoryError("upstream_error", "issueCreate failed", "kickoff_epic");
      }
      kickoff = createIssue.data.issueCreate.issue;
      kickoffCreated = true;
      steps.push({
        id: "kickoff_epic",
        status: "done",
        detail: kickoff.identifier,
      });
    } else {
      steps.push({
        id: "kickoff_epic",
        status: "skipped",
        detail: kickoff.identifier,
      });
    }

    kickoffForComment = kickoff;

    if (ideaIssueNode && kickoff) {
      if (!kickoffLinkedToIdea(kickoff, ideaIssueNode)) {
        const relation = await linearClient.request<{
          issueRelationCreate: { success: boolean };
        }>(ISSUE_RELATION_CREATE_MUTATION, {
          input: {
            issueId: kickoff.id,
            relatedIssueId: ideaIssueNode.id,
            type: "related",
          },
        });
        if (!relation.ok) {
          const mapped = mapLinearFailure(relation.error, "idea_issue_relation");
          auditStatus = mapped.error.code;
          failedStep = "idea_issue_relation";
          return mapped;
        }
        steps.push({
          id: "idea_issue_relation",
          status: "done",
          detail: ideaIssueNode.identifier,
        });
      } else {
        steps.push({
          id: "idea_issue_relation",
          status: "skipped",
          detail: ideaIssueNode.identifier,
        });
      }
    }

    let status: string;
    if (steps.every((s) => s.status === "skipped")) {
      status = "exists";
    } else if (repoLabelCreated || projectCreated || kickoffCreated) {
      status = "created";
    } else {
      status = "repaired";
    }

    auditStatus = status;
    auditResources = { project_url: project.url, kickoff_epic_url: kickoff.url };
    return {
      request_id: ctx.requestId,
      status,
      steps,
      warnings,
      project_url: project.url,
      project_label: projectLabelName,
      kickoff_epic: { identifier: kickoff.identifier, url: kickoff.url },
      dry_run: false,
    } as FactorySuccess & {
      project_url: string;
      project_label: string;
      kickoff_epic: { identifier: string; url: string };
      dry_run: boolean;
    };
  } finally {
    if (!dryRun && kickoffForComment && linearClient) {
      const commentBody = buildFactoryRunCommentBody({
        tool: "create_linear_project",
        caller: ctx.caller,
        approvalRef,
        status: auditStatus,
        projectUrl: auditResources.project_url,
        projectLabel: projectLabelName,
        kickoffIdentifier: kickoffForComment.identifier,
        kickoffUrl: kickoffForComment.url,
        steps,
      });
      const comment = await linearClient.request(COMMENT_CREATE_MUTATION, {
        input: {
          issueId: kickoffForComment.id,
          body: commentBody,
        },
      });
      if (!comment.ok) {
        warnings.push("Failed to post factory run comment on kickoff epic");
        steps.push({
          id: "post_run_comment",
          status: "failed",
          detail: mapLinearFailure(comment.error, "post_run_comment").error.message,
        });
      } else {
        steps.push({ id: "post_run_comment", status: "done" });
      }
    }
    finishAudit();
  }
}
