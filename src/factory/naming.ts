const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const RESERVED_NAMES = new Set([
  "launchpad",
  "project-factory",
  "nodrift",
  "we-met",
  "quorum",
  "autopilot",
  "web",
  "portfolio",
  "github",
  "api",
  "www",
  "admin",
  "app",
  "test",
  "staging",
  "preview",
]);

export type NameValidationResult =
  { ok: true } | { ok: false; code: "invalid_name" | "reserved_name"; message: string };

export function validateProjectName(name: string): NameValidationResult {
  if (!NAME_PATTERN.test(name) || name.length < 3 || name.length > 40) {
    return {
      ok: false,
      code: "invalid_name",
      message:
        "name must be 3 to 40 characters, lowercase, start with a letter, and use only letters, digits, and single hyphens between segments",
    };
  }
  if (name.startsWith("pr-")) {
    return {
      ok: false,
      code: "invalid_name",
      message: "name must not start with pr-",
    };
  }
  if (
    name.endsWith("-preview") ||
    name.endsWith("-staging") ||
    name.endsWith("-prod")
  ) {
    return {
      ok: false,
      code: "invalid_name",
      message: "name must not end with -preview, -staging, or -prod",
    };
  }
  if (RESERVED_NAMES.has(name)) {
    return {
      ok: false,
      code: "reserved_name",
      message: `name is reserved: ${name}`,
    };
  }
  return { ok: true };
}
