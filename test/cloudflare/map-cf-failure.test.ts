import { describe, expect, it } from "vitest";
import { mapCfFailure, trimCfErrorMessage } from "../../src/cloudflare/client.js";

describe("trimCfErrorMessage", () => {
  it("uses status and numeric code only", () => {
    expect(trimCfErrorMessage(403, 10000)).toBe("403 10000");
    expect(trimCfErrorMessage(500, undefined)).toBe("500 unknown");
  });
});

describe("mapCfFailure", () => {
  it("maps 401 to missing_secret", () => {
    expect(
      mapCfFailure({ status: 401, message: "x", code: 1000 }, "cf_accounts"),
    ).toEqual({
      error: {
        code: "missing_secret",
        message: "401 1000",
        step: "cf_accounts",
        retryable: false,
      },
    });
  });

  it("maps 403 to permission_denied", () => {
    expect(mapCfFailure({ status: 403, code: 10, message: "x" }, "step")).toEqual({
      error: {
        code: "permission_denied",
        message: "403 10",
        step: "step",
        retryable: false,
      },
    });
  });

  it("maps 429 to retryable rate_limited", () => {
    const r = mapCfFailure({ status: 429, code: 1005, message: "x" }, "step");
    expect(r.error.code).toBe("rate_limited");
    expect(r.error.retryable).toBe(true);
  });

  it("maps 5xx to retryable upstream_error", () => {
    const r = mapCfFailure({ status: 503, code: 0, message: "x" }, "step");
    expect(r.error.code).toBe("upstream_error");
    expect(r.error.retryable).toBe(true);
  });
});
