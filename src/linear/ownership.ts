import { REPO_PROJECT_LABEL_GROUP_NAME } from "../factory/linear-constants.js";
import { projectHasFactoryMarker } from "../factory/linear-content.js";
import type { LinearProjectNode, ProjectLabelNode } from "./operations.js";

export type RepoLabelConflict = {
  code: "conflict_not_factory_owned";
  message: string;
  step: "repo_project_label";
} | null;

export type ForeignProjectConflict = {
  code: "conflict_not_factory_owned";
  message: string;
  step: "read_project_by_label" | "read_project_by_name";
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
  step: "read_project_by_label" | "read_project_by_name",
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
