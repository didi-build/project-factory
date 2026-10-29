import { describe, expect, it } from "vitest";
import {
  mapGithubFailure,
  mapMintDryRunFailure,
  MISSING_GITHUB_APP_SECRET_MESSAGE,
} from "../../src/github/github-errors.js";

describe("mapGithubFailure", () => {
  it("maps secondary rate limit 403 to rate_limited", () => {
    const mapped = mapGithubFailure(
      {
        status: 403,
        code: "rate_limited",
        message: "403 rate_limited",
        retryable: true,
      },
      "read_repo",
    );
    expect(mapped.error).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });

  it("names both GitHub app id and private key for missing_secret", () => {
    const mapped = mapGithubFailure(
      {
        status: 401,
        code: "missing_secret",
        message: "401 missing_secret",
        retryable: false,
      },
      "mint_installation_token",
    );
    expect(mapped.error.message).toBe(MISSING_GITHUB_APP_SECRET_MESSAGE);
  });
});

describe("mapMintDryRunFailure", () => {
  it("maps mint 403 and 404 to permission_denied", () => {
    for (const status of [403, 404]) {
      const mapped = mapMintDryRunFailure({
        status,
        code: "permission_denied",
        message: `${status} permission_denied`,
        retryable: false,
      });
      expect(mapped).toMatchObject({ code: "permission_denied", retryable: false });
    }
  });
});
