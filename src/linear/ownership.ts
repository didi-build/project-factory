import { REPO_PROJECT_LABEL_GROUP_NAME } from "../factory/linear-constants.js";
import { projectHasFactoryMarker } from "../factory/linear-content.js";
import type { LinearProjectNode, ProjectLabelNode } from "./operations.js";

export type ProjectLookupStep = "read_project_by_label" | "read_project_by_name";

export type RepoLabelConflict = {
  code: "conflict_not_factory_owned";
  message: string;
  step: "repo_project_label";
} | null;

export type ForeignProjectConflict = {
  code: "conflict_not_factory_owned";
  message: string;
  step: ProjectLookupStep;
} | null;

export function detectRepoLabelConflict(
  labels: ProjectLabelNode[],
  projectLabelName: string,
  repoGroupId: string,
): RepoLabelConflict {
  const sameName = labels.filter((l) => !l.isGroup && l.name === projectLabelName);
  for (const label of sameName) {
    const parentId = label.parent?.id;
    if (!parentId || parentId !== repoGroupId) {
      return {
        code: "conflict_not_factory_owned",
        message: `project label ${projectLabelName} exists outside the ${REPO_PROJECT_LABEL_GROUP_NAME} group`,
        step: "repo_project_label",
      };
    }
  }
  return null;
}

export function detectForeignProjectConflict(
  project: LinearProjectNode,
  factoryName: string,
  step: ProjectLookupStep,
): ForeignProjectConflict {
  if (!projectHasFactoryMarker(project.description, factoryName)) {
    return {
      code: "conflict_not_factory_owned",
      message: `Linear project ${project.name} exists without the project-factory marker`,
      step,
    };
  }
  return null;
}

export function detectAmbiguousProjectLookup(
  projects: LinearProjectNode[],
  step: ProjectLookupStep,
): ForeignProjectConflict {
  if (projects.length <= 1) {
    return null;
  }
  const detail =
    step === "read_project_by_label"
      ? "multiple Linear projects share the repo label"
      : "multiple Linear projects match name and team";
  return {
    code: "conflict_not_factory_owned",
    message: detail,
    step,
  };
}

export function selectFactoryProject(
  projects: LinearProjectNode[],
  factoryName: string,
  step: ProjectLookupStep,
): { project?: LinearProjectNode; conflict: ForeignProjectConflict } {
  const ambiguous = detectAmbiguousProjectLookup(projects, step);
  if (ambiguous) {
    return { conflict: ambiguous };
  }
  if (projects.length === 0) {
    return { conflict: null };
  }
  const foreign = detectForeignProjectConflict(projects[0], factoryName, step);
  if (foreign) {
    return { conflict: foreign };
  }
  return { project: projects[0], conflict: null };
}
