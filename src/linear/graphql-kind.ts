export function isLinearMutation(query: string): boolean {
  return /^\s*mutation\b/im.test(query.trim());
}

export function isLinearQuery(query: string): boolean {
  return /^\s*query\b/im.test(query.trim());
}
