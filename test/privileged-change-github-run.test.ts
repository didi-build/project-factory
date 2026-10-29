import { describe, expect, it } from "vitest";
import {
  PRIVILEGED_CHANGE_MARKER,
  postPrivilegedChangeErrorStatus,
  runPrivilegedChange,
} from "../scripts/privileged-change-github.mjs";
import { privilegedChangeReviewedLabel } from "../scripts/lib/privileged-change-labels.mjs";

const WORKFLOW_PATH = ".github/workflows/x.yml";
const WORKFLOW_YAML = `name: X
on:
  push:
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`;

function baseEnv(overrides = {}) {
  return {
    GITHUB_REPOSITORY: "didi-build/project-factory",
    PR_NUMBER: "13",
    HEAD_SHA: "abc123deadbeef",
    TRUSTED_ORG: "didi-build",
    EVENT_ACTION: "synchronize",
    GH_TOKEN: "test-token",
    ...overrides,
  };
}

type Call = { cmd: string; args: string[]; input?: string };

function createFakeExec(handlers: {
  onCall?: (call: Call) => string | void;
  throwOnFirst?: boolean;
}) {
  const calls: Call[] = [];
  let first = true;
  const exec = (cmd: string, args: string[], opts?: { input?: string }) => {
    const call = { cmd, args, input: opts?.input };
    calls.push(call);
    if (handlers.throwOnFirst && first) {
      first = false;
      throw new Error("simulated API failure");
    }
    if (handlers.onCall) {
      const result = handlers.onCall(call);
      if (result !== undefined) {
        return result;
      }
    }
    return defaultHandler(call);
  };
  return { exec, calls };
}

function defaultHandler(call: Call) {
  const path = call.args.join(" ");
  if (call.cmd === "gh" && path.includes("label list")) {
    return JSON.stringify([
      { name: "privileged-change" },
      { name: privilegedChangeReviewedLabel },
    ]);
  }
  if (call.cmd === "gh" && path.includes("/pulls/") && path.includes("/files")) {
    return JSON.stringify([[{ filename: WORKFLOW_PATH, status: "added" }]]);
  }
  if (call.cmd === "gh" && path.includes("/pulls/13") && !path.includes("files")) {
    return JSON.stringify({ labels: [] });
  }
  if (call.cmd === "gh" && path.includes("/contents/")) {
    return JSON.stringify({
      content: Buffer.from(WORKFLOW_YAML).toString("base64"),
      encoding: "base64",
    });
  }
  if (call.cmd === "gh" && path.includes("/comments") && path.includes("--jq")) {
    return "";
  }
  if (call.cmd === "gh" && call.args.includes("POST") && path.includes("/comments")) {
    return "{}";
  }
  if (call.cmd === "gh" && call.args.includes("POST") && path.includes("/labels")) {
    return "{}";
  }
  if (call.cmd === "gh" && call.args.includes("POST") && path.includes("/statuses/")) {
    return "{}";
  }
  return "";
}

function callsWithStdin(calls: Call[]) {
  return calls.filter((c) => c.input !== undefined && c.input.length > 0);
}

function assertInputFlags(call: Call) {
  expect(call.args).toContain("--input");
  expect(call.args).toContain("-");
}

describe("runPrivilegedChange (integration with fake exec)", () => {
  it("synchronize with stale reviewed label: DELETE reviewed label and status failure", () => {
    const { exec, calls } = createFakeExec({
      onCall: (call) => {
        if (
          call.cmd === "gh" &&
          call.args.join(" ").includes("/pulls/13") &&
          !call.args.join(" ").includes("files")
        ) {
          return JSON.stringify({
            labels: [{ name: privilegedChangeReviewedLabel }],
          });
        }
      },
    });
    const code = runPrivilegedChange({
      exec,
      env: baseEnv({ EVENT_ACTION: "synchronize" }),
    });
    expect(code).toBe(0);

    const labelDelete = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("DELETE") &&
        c.args.some((a) => a.includes("/labels/")),
    );
    expect(labelDelete).toBeDefined();
    expect(labelDelete?.args.join(" ")).toContain(
      encodeURIComponent(privilegedChangeReviewedLabel),
    );

    const statusPost = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/statuses/")),
    );
    const statusBody = JSON.parse(statusPost!.input ?? "{}");
    expect(statusBody.state).toBe("failure");
  });

  it("creates missing repo labels before analysis", () => {
    const { exec, calls } = createFakeExec({
      onCall: (call) => {
        if (
          call.cmd === "gh" &&
          call.args.includes("label") &&
          call.args.includes("list")
        ) {
          return JSON.stringify([{ name: "bug" }]);
        }
      },
    });
    const code = runPrivilegedChange({ exec, env: baseEnv() });
    expect(code).toBe(0);
    const labelCreates = calls.filter(
      (c) => c.cmd === "gh" && c.args.includes("label") && c.args.includes("create"),
    );
    expect(labelCreates.length).toBeGreaterThanOrEqual(2);
    const createdNames = labelCreates.map((c) => c.args[c.args.indexOf("create") + 1]);
    expect(createdNames).toContain("privileged-change");
    expect(createdNames).toContain(privilegedChangeReviewedLabel);
  });

  it("missing labels and gh label create throws: exit 1 and failure privileged-change status", () => {
    const { exec: baseExec, calls } = createFakeExec({
      onCall: (call) => {
        if (
          call.cmd === "gh" &&
          call.args.includes("label") &&
          call.args.includes("list")
        ) {
          return JSON.stringify([{ name: "bug" }]);
        }
      },
    });
    const execThrowsOnCreate = (
      cmd: string,
      args: string[],
      opts?: { input?: string },
    ) => {
      if (cmd === "gh" && args.includes("label") && args.includes("create")) {
        throw new Error("label create failed");
      }
      return baseExec(cmd, args, opts);
    };
    const code = runPrivilegedChange({ exec: execThrowsOnCreate, env: baseEnv() });
    expect(code).toBe(1);
    const errorStatus = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/statuses/abc123deadbeef")),
    );
    expect(errorStatus).toBeDefined();
    const statusBody = JSON.parse(errorStatus!.input ?? "{}");
    expect(statusBody.state).toBe("failure");
    expect(statusBody.context).toBe("privileged-change");
    expect(statusBody.description).toContain("privileged-change check errored");
  });

  it("flagged PR: comment POST with marker, label POST, status failure, stdin uses --input -", () => {
    const { exec, calls } = createFakeExec({});
    const code = runPrivilegedChange({ exec, env: baseEnv() });
    expect(code).toBe(0);

    const commentPost = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/comments")) &&
        !c.args.includes("--jq"),
    );
    expect(commentPost).toBeDefined();
    expect(commentPost?.input).toContain(PRIVILEGED_CHANGE_MARKER);
    assertInputFlags(commentPost!);

    const labelPost = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/labels")),
    );
    expect(labelPost).toBeDefined();
    assertInputFlags(labelPost!);

    const statusPost = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/statuses/")),
    );
    expect(statusPost).toBeDefined();
    const statusBody = JSON.parse(statusPost!.input ?? "{}");
    expect(statusBody.state).toBe("failure");
    expect(statusBody.context).toBe("privileged-change");
    assertInputFlags(statusPost!);

    for (const call of callsWithStdin(calls)) {
      assertInputFlags(call);
    }
  });

  it("first API call throws: error status POST with body and non-zero exit", () => {
    const { exec, calls } = createFakeExec({ throwOnFirst: true });
    const code = runPrivilegedChange({ exec, env: baseEnv() });
    expect(code).toBe(1);

    const errorStatus = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/statuses/abc123deadbeef")),
    );
    expect(errorStatus).toBeDefined();
    expect(errorStatus?.input).toContain("privileged-change check errored");
    assertInputFlags(errorStatus!);
  });

  it("PR already has privileged-change-reviewed: status success", () => {
    const { exec, calls } = createFakeExec({
      onCall: (call) => {
        if (
          call.cmd === "gh" &&
          call.args.join(" ").includes("/pulls/13") &&
          !call.args.join(" ").includes("files")
        ) {
          return JSON.stringify({
            labels: [{ name: privilegedChangeReviewedLabel }],
          });
        }
      },
    });
    const code = runPrivilegedChange({
      exec,
      env: baseEnv({ EVENT_ACTION: "labeled" }),
    });
    expect(code).toBe(0);
    const statusPost = calls.find(
      (c) =>
        c.cmd === "gh" &&
        c.args.includes("POST") &&
        c.args.some((a) => a.includes("/statuses/")),
    );
    const statusBody = JSON.parse(statusPost!.input ?? "{}");
    expect(statusBody.state).toBe("success");
  });
});

describe("postPrivilegedChangeErrorStatus", () => {
  it("sends failure payload with --input -", () => {
    const calls: Call[] = [];
    const exec = (cmd: string, args: string[], opts?: { input?: string }) => {
      calls.push({ cmd, args, input: opts?.input });
      return "";
    };
    postPrivilegedChangeErrorStatus("didi-build/project-factory", "sha1", exec, {
      GH_TOKEN: "t",
    });
    expect(calls[0].args).toContain("--input");
    expect(JSON.parse(calls[0].input ?? "{}").state).toBe("failure");
  });
});
