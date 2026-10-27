export const LINEAR_PROJECT_DESCRIPTION_MAX_LENGTH = 255;

export function factoryProjectMarker(name: string): string {
  return `<!-- project-factory:${name} -->`;
}

export function factoryKickoffEpicMarker(projectId: string): string {
  return `<!-- project-factory:epic:${projectId} -->`;
}

export function kickoffEpicHasFactoryMarker(
  description: string | null | undefined,
  projectId: string,
): boolean {
  if (!description) {
    return false;
  }
  return description.includes(factoryKickoffEpicMarker(projectId));
}

export function projectHasFactoryMarker(
  description: string | null | undefined,
  name: string,
): boolean {
  if (!description) {
    return false;
  }
  return description.includes(factoryProjectMarker(name));
}

export function kickoffEpicTitle(displayName: string): string {
  return `${displayName}: kickoff`;
}

export function emptyProductDirectionBlock(): string {
  return `## Product direction (locked)

Only Diadem's own words go here, verbatim, each with its date and time (America/Toronto). Only CTO adds to this block, and only by quoting Diadem. Any change to recipients, counts, content or behaviour against this block needs a new Urgent Ready for maintainer ticket.

> (Empty. Waiting for Diadem's direction.)

| Area | Decision | Diadem's words (verbatim) | When |
| -- | -- | -- | -- |

### Changes
(None yet. Each change is recorded as: was ..., is ..., with Diadem's words and the time.)
`;
}

export function buildKickoffEpicDescription(
  projectId: string,
  summary: string,
): string {
  const summarySection = `## Summary

Factory input (not product direction):

${summary.trim()}
`;
  return `${emptyProductDirectionBlock()}\n${summarySection}\n${factoryKickoffEpicMarker(projectId)}`;
}

export function buildLinearProjectDescription(input: {
  summary: string;
  name: string;
  org: string;
}): string {
  const summary = input.summary.trim();
  const marker = factoryProjectMarker(input.name);
  const repoUrl = `https://github.com/${input.org}/${input.name}`;
  return `${summary}

GitHub: ${repoUrl}

${marker}`;
}

export type ProjectDescriptionValidation =
  { ok: true; description: string } | { ok: false; message: string };

export function validateProjectDescriptionLength(input: {
  summary: string;
  name: string;
  org: string;
}): ProjectDescriptionValidation {
  const description = buildLinearProjectDescription(input);
  if (description.length > LINEAR_PROJECT_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      message: `summary is too long for Linear project description (max ${LINEAR_PROJECT_DESCRIPTION_MAX_LENGTH} characters including GitHub link and marker)`,
    };
  }
  return { ok: true, description };
}

export function githubRepoUrl(org: string, name: string): string {
  return `https://github.com/${org}/${name}`;
}
