export function buildFactoryRunCommentBody(input: {
  tool: string;
  caller: string;
  approvalRef: string;
  status: string;
  projectUrl?: string;
  projectLabel: string;
  kickoffIdentifier?: string;
  kickoffUrl?: string;
  steps: { id: string; status: string }[];
}): string {
  const createdOrFound = input.steps
    .filter((s) => s.status === "done" || s.status === "skipped")
    .map((s) => `${s.id}: ${s.status}`)
    .join(", ");

  const lines = [
    "**Project factory run**",
    "",
    `- Tool: \`${input.tool}\``,
    `- Caller: ${input.caller}`,
    `- Approval: ${input.approvalRef}`,
    `- Result status: ${input.status}`,
    `- Project label: ${input.projectLabel}`,
  ];
  if (input.projectUrl) {
    lines.push(`- Project: ${input.projectUrl}`);
  }
  if (input.kickoffIdentifier && input.kickoffUrl) {
    lines.push(`- Kickoff epic: ${input.kickoffIdentifier} (${input.kickoffUrl})`);
  }
  lines.push(`- Steps: ${createdOrFound || "none"}`);
  return lines.join("\n");
}
