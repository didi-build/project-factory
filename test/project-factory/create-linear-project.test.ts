import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { LinearClient } from "../../src/linear/client.js";
import { detectRepoLabelConflict } from "../../src/linear/ownership.js";
import { createFactoryMcpServer } from "../../src/mcp/create-server.js";
import { createLinearProject } from "../../src/tools/create-linear-project.js";
import {
  createHarnessClient,
  mutationCalls,
  resourceMutationCalls,
  type GraphqlCall,
} from "./linear-fetch-harness.js";
import { buildLinearApiKey } from "./linear-mock.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
  PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey(),
};

const TEAM_ID = "cff86df5-36a6-4c6a-8527-7ef0bee09c1e";
const PROJECT_ID = "project-demo-uuid";
const STATE_ID = "state-cto-uuid";

const PRODUCT_DIRECTION_BLOCK = `## Product direction (locked)

Only Diadem's own words go here, verbatim, each with its date and time (America/Toronto). Only CTO adds to this block, and only by quoting Diadem. Any change to recipients, counts, content or behaviour against this block needs a new Urgent Ready for maintainer ticket.

> (Empty. Waiting for Diadem's direction.)

| Area | Decision | Diadem's words (verbatim) | When |
| -- | -- | -- | -- |

### Changes
(None yet. Each change is recorded as: was ..., is ..., with Diadem's words and the time.)
`;

const EXPECTED_PROJECT_DESCRIPTION = `A demo

GitHub: https://github.com/didi-build/demo-app

<!-- project-factory:demo-app -->`;

const EXPECTED_KICKOFF_DESCRIPTION = `${PRODUCT_DIRECTION_BLOCK}
## Summary

Factory input (not product direction):

A demo

<!-- project-factory:epic:${PROJECT_ID} -->`;

const EXPECTED_RUN_COMMENT = `**Project factory run**

- Tool: \`create_linear_project\`
- Caller: test-bot
- Approval: https://linear.app/didi-build/issue/DIDI-1
- Result status: created
- Project label: didi-build/demo-app
- Project: https://linear.app/didi-build/project/demo
- Kickoff epic: DIDI-900 (https://linear.app/didi-build/issue/DIDI-900)
- Steps: repo_project_label: done, linear_project: done, github_link: done, kickoff_epic: done`;

const baseInput = {
  name: "demo-app",
  display_name: "Demo App",
  summary: "A demo",
  approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
  dry_run: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function auditLine(logSpy: ReturnType<typeof vi.spyOn>, requestId: string) {
  return logSpy.mock.calls
    .map((c) => String(c[0]))
    .find((line) => line.includes("factory_call") && line.includes(requestId));
}

describe("createLinearProject", () => {
  it("dry_run performs reads only (no mutations)", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    const result = await createLinearProject(
      { env, requestId: "dry-1", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({ status: "planned", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("dry_run returns conflict for foreign project", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { projectExists: true, factoryMarker: false },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "dry-conflict", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({ status: "conflict", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("dry_run returns conflict for label outside repo group", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({ labelOutsideRepoGroup: true }, calls);
    const result = await createLinearProject(
      { env, requestId: "dry-label-conflict", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({ status: "conflict", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("dry_run warns on team read failure without treating resources as missing", async () => {
    const client = new LinearClient({
      apiKey: buildLinearApiKey(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ errors: [{ message: "bad gateway" }] }), {
          status: 502,
        }),
    });
    const result = await createLinearProject(
      { env, requestId: "dry-read-fail", caller: "test", linear: client },
      { ...baseInput, dry_run: true },
    );
    const planned = result as unknown as {
      warnings: string[];
      linear: { project_exists: boolean | null };
    };
    expect(planned.warnings[0]).toContain("team read failed");
    expect(planned.linear.project_exists).toBeNull();
  });

  it("creates resources with literal GraphQL payloads", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    await createLinearProject(
      { env, requestId: "create-1", caller: "test-bot", linear },
      baseInput,
    );

    const projectCreate = calls.find((c) => c.query.includes("ProjectCreate"));
    expect(projectCreate?.variables).toEqual({
      input: {
        name: "Demo App",
        teamIds: [TEAM_ID],
        description: EXPECTED_PROJECT_DESCRIPTION,
        labelIds: ["label-demo-uuid"],
      },
    });

    const issueCreate = calls.find((c) => c.query.includes("IssueCreate"));
    expect(issueCreate?.variables).toEqual({
      input: {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        title: "Demo App: kickoff",
        description: EXPECTED_KICKOFF_DESCRIPTION,
        stateId: STATE_ID,
      },
    });

    const workflow = calls.find((c) => c.query.includes("WorkflowStates"));
    expect(workflow?.variables).toEqual({
      filter: {
        team: { id: { eq: TEAM_ID } },
        name: { eq: "Ready for CTO breakdown" },
      },
    });
  });

  it("is idempotent and does not change kickoff state on rerun with a different display_name", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        kickoffStateId: "other-state-id",
      },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "exists-1", caller: "test", linear },
      { ...baseInput, display_name: "Renamed App" },
    );
    expect(result).toMatchObject({ status: "exists" });
    expect(calls.some((c) => c.query.includes("IssueUpdate"))).toBe(false);
    expect(resourceMutationCalls(calls)).toHaveLength(0);
    expect(
      mutationCalls(calls).filter((c) => c.query.includes("CommentCreate")),
    ).toHaveLength(1);
  });

  it("returns conflict for label outside repo group with zero writes", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({ labelOutsideRepoGroup: true }, calls);
    const result = await createLinearProject(
      { env, requestId: "conflict-label", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "conflict_not_factory_owned", step: "repo_project_label" },
    });
    expect(resourceMutationCalls(calls)).toHaveLength(0);
  });

  it("returns conflict for foreign project with zero writes", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { labelExists: true, projectExists: true, factoryMarker: false },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "conflict-project", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "conflict_not_factory_owned" },
    });
    expect(resourceMutationCalls(calls)).toHaveLength(0);
  });

  it("ownership unit test fails if repo label conflict detection is disabled", () => {
    expect(
      detectRepoLabelConflict(
        [
          {
            id: "x",
            name: "didi-build/demo-app",
            isGroup: false,
            parent: { id: "wrong", name: "wrong" },
          },
        ],
        "didi-build/demo-app",
        "group-repo-uuid",
      ),
    ).not.toBeNull();
  });

  it("skips idea relation when idea already links to kickoff", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        ideaIssue: true,
        ideaHasRelationToKickoff: true,
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "idea-skip", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    expect(calls.some((c) => c.query.includes("IssueRelationCreate"))).toBe(false);
  });

  it("rejects invalid input with zero Linear calls", async () => {
    const fetchImpl = () => {
      throw new Error("Linear must not be called");
    };
    const result = await createLinearProject(
      { env, requestId: "invalid", caller: "test", fetchImpl },
      { ...baseInput, summary: "", dry_run: false },
    );
    expect(result).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("rejects summary that exceeds Linear project description limit", async () => {
    const fetchImpl = () => {
      throw new Error("Linear must not be called");
    };
    const result = await createLinearProject(
      { env, requestId: "long-summary", caller: "test", fetchImpl },
      {
        ...baseInput,
        summary: "x".repeat(300),
        dry_run: false,
      },
    );
    expect(result).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("posts one run comment on write and not on dry_run", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    await createLinearProject(
      { env, requestId: "comment-write", caller: "test-bot", linear },
      baseInput,
    );
    const comment = calls.find((c) => c.query.includes("CommentCreate"));
    expect(comment?.variables).toEqual({
      input: {
        issueId: "kickoff-uuid",
        body: EXPECTED_RUN_COMMENT,
      },
    });

    const dryCalls: GraphqlCall[] = [];
    const dryLinear = createHarnessClient({}, dryCalls);
    await createLinearProject(
      { env, requestId: "comment-dry", caller: "test-bot", linear: dryLinear },
      { ...baseInput, dry_run: true },
    );
    expect(dryCalls.some((c) => c.query.includes("CommentCreate"))).toBe(false);
  });

  it("writes audit entries for success, exists, conflict, and invalid input", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await createLinearProject(
      {
        env,
        requestId: "audit-success",
        caller: "test",
        linear: createHarnessClient({}),
      },
      baseInput,
    );
    expect(auditLine(logSpy, "audit-success")).toContain('"status":"created"');

    const existsCalls: GraphqlCall[] = [];
    await createLinearProject(
      {
        env,
        requestId: "audit-exists",
        caller: "test",
        linear: createHarnessClient(
          { labelExists: true, projectExists: true, kickoffExists: true },
          existsCalls,
        ),
      },
      baseInput,
    );
    expect(auditLine(logSpy, "audit-exists")).toContain('"status":"exists"');

    await createLinearProject(
      {
        env,
        requestId: "audit-conflict",
        caller: "test",
        linear: createHarnessClient({ labelOutsideRepoGroup: true }),
      },
      baseInput,
    );
    expect(auditLine(logSpy, "audit-conflict")).toContain(
      '"status":"conflict_not_factory_owned"',
    );

    await createLinearProject(
      {
        env,
        requestId: "audit-invalid",
        caller: "test",
        fetchImpl: async () => new Response(),
      },
      { ...baseInput, approval_ref: "  " },
    );
    expect(auditLine(logSpy, "audit-invalid")).toContain('"status":"invalid_input"');
  });

  it("records partial failure in audit when a mutation fails after kickoff exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        failMutation: "CommentCreate",
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "partial", caller: "test-bot", linear },
      baseInput,
    );
    const line = auditLine(logSpy, "partial");
    expect(line).toContain('"status":"exists"');
    expect(line).toContain("post_run_comment");
  });

  it("never leaks the Linear API key", async () => {
    const apiKey = buildLinearApiKey();
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: apiKey },
        requestId: "leak",
        caller: "test",
        linear,
      },
      baseInput,
    );
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(calls.map((c) => JSON.stringify(c)).join("")).not.toContain(apiKey);
  });

  it("registers create_linear_project on the MCP server", () => {
    const server = createFactoryMcpServer(env, "req-mcp", "mcp-caller");
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools).toHaveProperty("create_linear_project");
  });
});
