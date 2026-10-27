import { GITHUB_API_LIST_MAX_PAGES } from "./pagination.js";

export async function paginateGithubApiList<T>(
  fetchPage: (
    page: number,
  ) => Promise<{ ok: true; items: T[] } | { ok: false; error: unknown }>,
  pageSize: number,
  maxPages: number = GITHUB_API_LIST_MAX_PAGES,
): Promise<
  | { ok: true; items: T[] }
  | { ok: false; error: unknown }
  | { ok: false; pageLimitExceeded: true }
> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    if (!result.ok) {
      return result;
    }
    all.push(...result.items);
    if (result.items.length < pageSize) {
      return { ok: true, items: all };
    }
    if (page === maxPages) {
      return { ok: false, pageLimitExceeded: true };
    }
  }
  return { ok: true, items: all };
}
