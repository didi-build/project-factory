export function decodeGithubFileContent(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const content = (data as { content?: string }).content;
  if (!content) {
    return null;
  }
  return atob(content.replace(/\n/g, ""));
}

export function readmeHasLaunchpadPlaceholders(data: unknown): boolean {
  const decoded = decodeGithubFileContent(data);
  if (decoded === null) {
    return true;
  }
  return decoded.includes("{{");
}
