import { describe, expect, it } from "vitest";
import { readmeHasLaunchpadPlaceholders } from "../../src/factory/github-content.js";

describe("readmeHasLaunchpadPlaceholders", () => {
  it("detects placeholders in decoded README content", () => {
    const content = btoa("# {{PROJECT_NAME}}\n");
    expect(readmeHasLaunchpadPlaceholders({ content })).toBe(true);
  });

  it("passes when decoded README has no placeholders", () => {
    const content = btoa("# My Project\n");
    expect(readmeHasLaunchpadPlaceholders({ content })).toBe(false);
  });
});
