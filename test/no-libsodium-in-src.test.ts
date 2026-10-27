import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("runtime src must not import libsodium-wrappers", () => {
  it("has no libsodium-wrappers imports under src/", () => {
    const files = walk(join(process.cwd(), "src"));
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes("libsodium-wrappers"),
    );
    expect(offenders).toEqual([]);
  });
});
