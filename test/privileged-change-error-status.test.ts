import { describe, expect, it } from "vitest";
import { privilegedChangeErrorStatusPayload } from "../scripts/lib/privileged-change-status.mjs";

describe("privileged-change error status (unit)", () => {
  it("privilegedChangeErrorStatusPayload is failure with manual review description", () => {
    expect(privilegedChangeErrorStatusPayload()).toEqual({
      state: "failure",
      context: "privileged-change",
      description: "privileged-change check errored, review manually",
    });
  });
});
