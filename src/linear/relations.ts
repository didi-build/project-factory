import type { LinearIssueNode } from "./operations.js";

export function kickoffLinkedToIdea(
  kickoff: LinearIssueNode,
  idea: LinearIssueNode,
): boolean {
  const kickoffRelations = kickoff.relations?.nodes ?? [];
  if (
    kickoffRelations.some((r) => r.type === "related" && r.relatedIssue?.id === idea.id)
  ) {
    return true;
  }
  const ideaRelations = idea.relations?.nodes ?? [];
  return ideaRelations.some(
    (r) =>
      r.type === "related" &&
      (r.relatedIssue?.id === kickoff.id || r.issue?.id === kickoff.id),
  );
}
