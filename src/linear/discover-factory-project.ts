import type { FactoryError } from "../tools/types.js";
import { selectFactoryProject } from "./ownership.js";
import {
  findProjects,
  teamScopedProjectNameFilter,
  type LinearProjectNode,
} from "./operations.js";
import type { LinearClient } from "./client.js";

export type DiscoverFactoryProjectResult =
  | { ok: true; project?: LinearProjectNode }
  | {
      ok: false;
      reason: "conflict";
      conflict: NonNullable<ReturnType<typeof selectFactoryProject>["conflict"]>;
    }
  | { ok: false; reason: "read"; readError: FactoryError; step: string };

export async function discoverFactoryProject(
  linear: LinearClient,
  input: {
    teamId: string;
    displayName: string;
    factoryName: string;
    repoLabelId?: string;
  },
): Promise<DiscoverFactoryProjectResult> {
  if (input.repoLabelId) {
    const byLabel = await findProjects(
      linear,
      { labels: { id: { eq: input.repoLabelId } } },
      "read_project_by_label",
    );
    if (!byLabel.ok) {
      return {
        ok: false,
        reason: "read",
        readError: byLabel.error,
        step: byLabel.step,
      };
    }
    const fromLabel = selectFactoryProject(
      byLabel.projects,
      input.factoryName,
      "read_project_by_label",
    );
    if (fromLabel.conflict) {
      return { ok: false, reason: "conflict", conflict: fromLabel.conflict };
    }
    if (fromLabel.project) {
      return { ok: true, project: fromLabel.project };
    }
  }

  const byName = await findProjects(
    linear,
    teamScopedProjectNameFilter(input.teamId, input.displayName),
    "read_project_by_name",
  );
  if (!byName.ok) {
    return { ok: false, reason: "read", readError: byName.error, step: byName.step };
  }
  const fromName = selectFactoryProject(
    byName.projects,
    input.factoryName,
    "read_project_by_name",
  );
  if (fromName.conflict) {
    return { ok: false, reason: "conflict", conflict: fromName.conflict };
  }
  return { ok: true, project: fromName.project };
}
