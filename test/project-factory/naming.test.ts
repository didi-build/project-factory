import { describe, expect, it } from "vitest";
import { validateProjectName } from "../../src/factory/naming.js";

describe("validateProjectName", () => {
  it("accepts valid names", () => {
    expect(validateProjectName("my-app")).toEqual({ ok: true });
  });

  it("rejects short names", () => {
    const result = validateProjectName("ab");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_name");
    }
  });

  it("rejects reserved names", () => {
    const result = validateProjectName("launchpad");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("reserved_name");
    }
  });

  it("rejects pr- prefix", () => {
    const result = validateProjectName("pr-foo");
    expect(result.ok).toBe(false);
  });
});
