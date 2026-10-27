import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../../src/github/client.js";
import { paginateGithubApiList } from "../../src/github/paginate-list.js";
import { listRepoSecretNames } from "../../src/github/secrets.js";

describe("paginateGithubApiList", () => {
  it("returns pageLimitExceeded when every page is full", async () => {
    const result = await paginateGithubApiList(
      async () => ({
        ok: true,
        items: Array.from({ length: 100 }, (_, i) => ({ name: `secret-${i}` })),
      }),
      100,
      2,
    );
    expect(result).toEqual({ ok: false, pageLimitExceeded: true });
  });
});

describe("listRepoSecretNames", () => {
  it("maps page limit exceeded to list page limit exceeded", async () => {
    const github = {
      request: vi.fn(async () => ({
        ok: true,
        data: {
          secrets: Array.from({ length: 100 }, (_, i) => ({ name: `s${i}` })),
        },
      })),
    } as unknown as GitHubClient;

    const result = await listRepoSecretNames(github, "didi-build/demo-app");
    expect(result).toMatchObject({
      ok: false,
      error: {
        error: {
          message: "list page limit exceeded",
          step: "list_repo_secrets",
        },
      },
    });
  });

  it("marks GitHub 5xx list failures as retryable", async () => {
    const github = {
      request: vi.fn(async () => ({
        ok: false,
        error: {
          status: 503,
          message: "503 unknown",
          code: "unknown",
          retryable: true,
        },
      })),
    } as unknown as GitHubClient;

    const result = await listRepoSecretNames(github, "didi-build/demo-app");
    expect(result).toMatchObject({
      ok: false,
      error: { error: { retryable: true, step: "list_repo_secrets" } },
    });
  });
});
