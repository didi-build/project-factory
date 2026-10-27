import { describe, expect, it } from "vitest";
import type { CfResult } from "../../src/cloudflare/cf-result.js";
import { paginateCloudflareList } from "../../src/cloudflare/paginate.js";

describe("paginateCloudflareList", () => {
  it("stops at maxPages when every page is full", async () => {
    const result = await paginateCloudflareList(
      async (page): Promise<CfResult<number[]>> => {
        if (page > 2) {
          return { ok: true, data: [] };
        }
        return { ok: true, data: Array.from({ length: 50 }, (_, i) => i) };
      },
      2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("list page limit exceeded");
    }
  });

  it("returns hard error when a page fetch fails", async () => {
    const result = await paginateCloudflareList(
      async (): Promise<CfResult<number[]>> => ({
        ok: false,
        status: 500,
        message: "boom",
        code: 1,
      }),
    );
    expect(result).toEqual({ ok: false, status: 500, message: "boom", code: 1 });
  });
});
