import type { CfResult } from "./cf-result.js";

export const CF_API_LIST_MAX_PAGES = 100;

export async function paginateCloudflareList<T>(
  fetchPage: (page: number) => Promise<CfResult<T[]>>,
  maxPages: number = CF_API_LIST_MAX_PAGES,
): Promise<CfResult<T[]>> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    if (!result.ok) {
      return result;
    }
    all.push(...result.data);
    if (result.data.length < 50) {
      return { ok: true, data: all };
    }
    if (page === maxPages) {
      return {
        ok: false,
        status: 400,
        message: "list page limit exceeded",
        code: 0,
      };
    }
  }
  return { ok: true, data: all };
}
