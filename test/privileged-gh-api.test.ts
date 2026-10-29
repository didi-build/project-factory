import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGhApiArgs,
  GH_API_EXEC_MAX_BUFFER,
  ghApiCall,
} from "../scripts/lib/privileged-gh-api.mjs";

type GhExec = (
  file: string,
  args: string[],
  options?: {
    encoding?: string;
    input?: string;
    env?: Record<string, string | undefined>;
    stdio?: string;
    maxBuffer?: number;
  },
) => string;

describe("privileged-gh-api buildGhApiArgs (table)", () => {
  const cases: {
    args: string[];
    hasInput: boolean;
    expected: string[];
  }[] = [
    {
      args: ["repos/o/r/pulls/1"],
      hasInput: false,
      expected: ["api", "repos/o/r/pulls/1"],
    },
    {
      args: ["--method", "POST", "repos/o/r/issues/1/comments"],
      hasInput: true,
      expected: [
        "api",
        "--method",
        "POST",
        "repos/o/r/issues/1/comments",
        "--input",
        "-",
      ],
    },
  ];

  for (const { args, hasInput, expected } of cases) {
    it(`${hasInput ? "with" : "without"} input: ${args.join(" ")}`, () => {
      expect(buildGhApiArgs(args, hasInput)).toEqual(expected);
    });
  }
});

describe("privileged-gh-api ghApiCall (unit)", () => {
  it("passes maxBuffer, encoding, and GH_TOKEN for calls without stdin", () => {
    const exec: GhExec = (file, args, options) => {
      expect(file).toBe("gh");
      expect(args).toEqual(["api", "repos/o/r"]);
      expect(options?.encoding).toBe("utf8");
      expect(options?.maxBuffer).toBe(GH_API_EXEC_MAX_BUFFER);
      expect(options?.input).toBeUndefined();
      expect(options?.env?.GH_TOKEN).toBe("from-github-token");
      return '{"ok":true}';
    };
    const out = ghApiCall(exec, { GITHUB_TOKEN: "from-github-token" }, ["repos/o/r"]);
    expect(out).toBe('{"ok":true}');
  });

  it("passes maxBuffer and stdin input when body is provided", () => {
    const exec: GhExec = (file, args, options) => {
      expect(file).toBe("gh");
      expect(args).toEqual([
        "api",
        "--method",
        "POST",
        "repos/o/r/issues/1/comments",
        "--input",
        "-",
      ]);
      expect(options?.encoding).toBe("utf8");
      expect(options?.maxBuffer).toBe(GH_API_EXEC_MAX_BUFFER);
      expect(options?.input).toBe('{"body":"hi"}');
      expect(options?.env?.GH_TOKEN).toBe("explicit");
      return "{}";
    };
    ghApiCall(
      exec,
      { GH_TOKEN: "explicit" },
      ["--method", "POST", "repos/o/r/issues/1/comments"],
      '{"body":"hi"}',
    );
  });

  it("reads child output larger than Node default maxBuffer when maxBuffer is set (integration)", () => {
    const dir = join(tmpdir(), `fake-gh-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "gh");
    writeFileSync(script, "#!/bin/sh\nyes x | head -c 2000000\n", { mode: 0o755 });
    chmodSync(script, 0o755);

    let defaultBufferError: unknown;
    try {
      execFileSync(script, ["api", "noop"], { encoding: "utf8" });
    } catch (error) {
      defaultBufferError = error;
    }
    expect(defaultBufferError).toMatchObject({ code: "ENOBUFS" });

    const execViaFakeGh: GhExec = (file, args, options) => {
      expect(file).toBe("gh");
      return execFileSync(script, args, {
        encoding: "utf8",
        maxBuffer: options?.maxBuffer,
      });
    };
    const out = ghApiCall(execViaFakeGh, {}, ["noop"]);
    expect(out.length).toBe(2_000_000);
  });
});
