export function factoryProjectMarker(name: string): string {
  return `<!-- project-factory:${name} -->`;
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

Do not edit this block except to add Diadem's verbatim words with a timestamp. Any change to what the factory creates, the access it holds, or who sets up access versus this block needs an Urgent Ready for maintainer ticket for Diadem.
`;
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

export function githubRepoUrl(org: string, name: string): string {
  return `https://github.com/${org}/${name}`;
}
