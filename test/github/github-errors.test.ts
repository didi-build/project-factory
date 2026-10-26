import { describe, expect, it } from "vitest";
import { mapGithubFailure } from "../../src/github/github-errors.js";

describe("mapGithubFailure", () => {
  it("maps secondary rate limit 403 to rate_limited", () => {
    const mapped = mapGithubFailure(
      {
        status: 403,
        code: "rate_limited",
        message: "secondary rate limit",
        retryable: true,
      },
      "read_repo",
    );
    expect(mapped.error).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });
});
