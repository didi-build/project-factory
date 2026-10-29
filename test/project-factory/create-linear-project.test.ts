import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { validateProjectDescriptionLength } from "../../src/factory/linear-content.js";
import { LinearClient } from "../../src/linear/client.js";
import { detectRepoLabelConflict } from "../../src/linear/ownership.js";
import { createFactoryMcpServer } from "../../src/mcp/create-server.js";
import * as createLinearProjectModule from "../../src/tools/create-linear-project.js";
import { createLinearProject } from "../../src/tools/create-linear-project.js";
import {
  createHarnessClient,
  defaultHarnessProject,
  LINEAR_RAW_GRAPHQL_200_LEAK_MARKER,
  mutationCalls,
  resourceMutationCalls,
  type GraphqlCall,
  type HarnessState,
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

const validMcpLinearInput = {
  name: "demo-app",
  display_name: "Demo App",
  summary: "A demo",
  approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
};

type McpCreateLinearProjectTool = {
  inputSchema: {
    parse: (input: Record<string, unknown>) => Record<string, unknown>;
  };
  executor: (
    input: Record<string, unknown>,
  ) => Promise<{ content: { text: string }[] }>;
};

function getCreateLinearProjectMcpTool(
  server: ReturnType<typeof createFactoryMcpServer>,
): McpCreateLinearProjectTool {
  return (
    server as unknown as {
      _registeredTools: { create_linear_project: McpCreateLinearProjectTool };
    }
  )._registeredTools.create_linear_project;
}

async function runRegisteredMcpCreateLinearProject(
  requestId: string,
  input: Record<string, unknown>,
  calls: GraphqlCall[],
): Promise<{ content: { text: string }[] }> {
  const linear = createHarnessClient({}, calls);
  const spy = vi.spyOn(createLinearProjectModule, "createLinearProject");
  spy.mockImplementation((ctx, toolInput) => {
    expect(toolInput.dry_run).not.toBe(false);
    spy.mockRestore();
    return createLinearProjectModule.createLinearProject({ ...ctx, linear }, toolInput);
  });
  const server = createFactoryMcpServer(env, requestId, "mcp-dry-run-caller");
  const tool = getCreateLinearProjectMcpTool(server);
  const response = await tool.executor(input);
  return response;
}

describe("createLinearProject MCP handler (create-server registration)", () => {
  it("runs dry_run when dry_run is omitted from valid MCP input", async () => {
    const calls: GraphqlCall[] = [];
    const response = await runRegisteredMcpCreateLinearProject(
      "mcp-omit-dry-run",
      validMcpLinearInput,
      calls,
    );
    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      dry_run: boolean;
    };
    expect(payload).toMatchObject({ status: "planned", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("runs dry_run when dry_run is true on valid MCP input", async () => {
    const calls: GraphqlCall[] = [];
    const response = await runRegisteredMcpCreateLinearProject(
      "mcp-explicit-dry-run",
      { ...validMcpLinearInput, dry_run: true },
      calls,
    );
    const payload = JSON.parse(response.content[0].text) as {
      status: string;
      dry_run: boolean;
    };
    expect(payload).toMatchObject({ status: "planned", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("rejects empty summary via MCP handler before Linear is called", async () => {
    const calls: GraphqlCall[] = [];
    const response = await runRegisteredMcpCreateLinearProject(
      "mcp-empty-summary",
      { ...validMcpLinearInput, summary: "" },
      calls,
    );
    const payload = JSON.parse(response.content[0].text) as {
      error?: { code: string };
    };
    expect(payload).toMatchObject({ error: { code: "invalid_input" } });
    expect(calls).toHaveLength(0);
  });

  it("rejects empty summary in create_linear_project MCP inputSchema", () => {
    const server = createFactoryMcpServer(env, "mcp-schema-summary", "mcp-caller");
    const tool = getCreateLinearProjectMcpTool(server);
    expect(() =>
      tool.inputSchema.parse({
        ...validMcpLinearInput,
        summary: "",
      }),
    ).toThrow();
  });
});

describe("createLinearProject", () => {
  it("defaults dry_run to true when omitted from handler input", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    const result = await createLinearProject(
      { env, requestId: "dry-default", caller: "test", linear },
      {
        name: baseInput.name,
        display_name: baseInput.display_name,
        summary: baseInput.summary,
        approval_ref: baseInput.approval_ref,
      },
    );
    expect(result).toMatchObject({ status: "planned", dry_run: true });
    expect(mutationCalls(calls)).toHaveLength(0);
  });

  it("dry_run performs reads only (no mutations)", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    const result = await createLinearProject(
      { env, requestId: "dry-1", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({
      status: "planned",
      dry_run: true,
      project_url: null,
    });
    expect(mutationCalls(calls)).toHaveLength(0);
    const byName = calls.find((c) => c.query.includes("ProjectsByName"));
    expect(byName?.variables).toEqual({
      filter: {
        name: { eq: "Demo App" },
        accessibleTeams: { id: { eq: TEAM_ID } },
      },
    });
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

  it("dry_run matches write path when label exists but foreign project matches by name", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectsByLabelNodes: [],
        projectsByNameNodes: [defaultHarnessProject(false)],
      },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "dry-name-conflict", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({ status: "conflict", dry_run: true });
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

    const teamsQuery = calls.find((c) => c.query.includes("query Teams"));
    expect(teamsQuery?.variables).toEqual({
      filter: { name: { eq: "Didi Build" } },
    });

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

    const kickoffQuery = calls.find((c) => c.query.includes("KickoffByMarker"));
    expect(kickoffQuery?.variables).toEqual({
      filter: {
        project: { id: { eq: PROJECT_ID } },
        description: { contains: `<!-- project-factory:epic:${PROJECT_ID} -->` },
      },
    });
  });

  it("repairs an existing project missing the repo label on labels.nodes", async () => {
    const calls: GraphqlCall[] = [];
    const EXTRA_LABEL_ID = "other-label-uuid";
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        existingProjectMissingRepoLabel: true,
        existingProjectExtraLabelId: EXTRA_LABEL_ID,
      },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "repair-label", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({ status: "repaired" });
    const projectUpdate = calls.find((c) => c.query.includes("ProjectUpdate"));
    expect(projectUpdate?.variables).toEqual({
      id: PROJECT_ID,
      input: { labelIds: [EXTRA_LABEL_ID, "label-demo-uuid"] },
    });
    if (!("steps" in result)) {
      throw new Error("expected success result");
    }
    expect(
      result.steps.some((s) => s.id === "linear_project_repair" && s.status === "done"),
    ).toBe(true);
  });

  it("returns upstream error when label repair ProjectUpdate fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        existingProjectMissingRepoLabel: true,
        existingProjectExtraLabelId: "other-label-uuid",
        failMutation: "ProjectUpdate",
      },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "repair-label-fail", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "upstream_error", step: "linear_project" },
    });
    expect(calls.some((c) => c.query.includes("ProjectUpdate"))).toBe(true);
    const line = auditLine(logSpy, "repair-label-fail");
    expect(line).toContain('"failed_step":"linear_project"');
    expect(line).not.toContain("linear_project_repair");
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

  it("skips idea relation when kickoff already has a related link to the idea", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        ideaIssue: true,
        kickoffHasRelationToIdea: true,
        kickoffRelationType: "related",
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "kickoff-related-skip", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    expect(calls.some((c) => c.query.includes("IssueRelationCreate"))).toBe(false);
  });

  it("creates idea relation when kickoff has related link to a different issue", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        ideaIssue: true,
        kickoffHasRelationToIdea: true,
        kickoffRelationType: "related",
        kickoffRelationRelatedIssueId: "unrelated-issue-uuid",
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "kickoff-related-other", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    const relation = calls.find((c) => c.query.includes("IssueRelationCreate"));
    expect(relation?.variables).toEqual({
      input: {
        issueId: "kickoff-uuid",
        relatedIssueId: "idea-uuid",
        type: "related",
      },
    });
  });

  it("creates idea relation when kickoff only has a non-related link to the idea", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        ideaIssue: true,
        kickoffHasRelationToIdea: true,
        kickoffRelationType: "blocks",
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "kickoff-blocks-link", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    const relation = calls.find((c) => c.query.includes("IssueRelationCreate"));
    expect(relation?.variables).toEqual({
      input: {
        issueId: "kickoff-uuid",
        relatedIssueId: "idea-uuid",
        type: "related",
      },
    });
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

  it("returns conflict for foreign project found by name when label has no project", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectsByLabelNodes: [],
        projectsByNameNodes: [defaultHarnessProject(false)],
      },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "conflict-by-name", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "conflict_not_factory_owned", step: "read_project_by_name" },
    });
    expect(resourceMutationCalls(calls)).toHaveLength(0);
    const byName = calls.find((c) => c.query.includes("ProjectsByName"));
    expect(
      (byName?.variables as { filter?: Record<string, unknown> })?.filter,
    ).toMatchObject({
      accessibleTeams: { id: { eq: TEAM_ID } },
    });
  });

  it("returns conflict when multiple projects share the repo label", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectsByLabelNodes: [
          defaultHarnessProject(true),
          { ...defaultHarnessProject(false), id: "project-foreign-uuid" },
        ],
      },
      calls,
    );
    const dry = await createLinearProject(
      { env, requestId: "ambig-dry", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(dry).toMatchObject({ status: "conflict" });
    const write = await createLinearProject(
      {
        env,
        requestId: "ambig-write",
        caller: "test",
        linear: createHarnessClient(
          {
            labelExists: true,
            projectsByLabelNodes: [
              defaultHarnessProject(true),
              { ...defaultHarnessProject(false), id: "project-foreign-uuid" },
            ],
          },
          calls,
        ),
      },
      baseInput,
    );
    expect(write).toMatchObject({ error: { code: "conflict_not_factory_owned" } });
  });

  it("validates project description length at 172 and 173 characters for demo-app", () => {
    expect(
      validateProjectDescriptionLength({
        name: "demo-app",
        org: "didi-build",
        summary: "x".repeat(172),
      }).ok,
    ).toBe(true);
    expect(
      validateProjectDescriptionLength({
        name: "demo-app",
        org: "didi-build",
        summary: "x".repeat(173),
      }).ok,
    ).toBe(false);
  });

  it("rejects empty display_name and whitespace-only fields without Linear calls", async () => {
    const fetchImpl = () => {
      throw new Error("Linear must not be called");
    };
    expect(
      await createLinearProject(
        { env, requestId: "bad-display", caller: "test", fetchImpl },
        { ...baseInput, display_name: "  " },
      ),
    ).toMatchObject({ error: { code: "invalid_input" } });
    expect(
      await createLinearProject(
        { env, requestId: "bad-summary", caller: "test", fetchImpl },
        { ...baseInput, summary: "   " },
      ),
    ).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("returns failed_step when a Linear read fails on the write path", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { labelExists: true, failRead: "WorkflowStates" },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "read-fail", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "upstream_error", step: "read_workflow_state" },
    });
  });

  it("records partial failure when project create fails after label was created", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({ failMutation: "ProjectCreate" }, calls);
    const result = await createLinearProject(
      { env, requestId: "partial-project", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "upstream_error", step: "linear_project" },
    });
    expect(calls.some((c) => c.query.includes("ProjectLabelCreate"))).toBe(true);
    expect(calls.some((c) => c.query.includes("ProjectCreate"))).toBe(true);
    const line = auditLine(logSpy, "partial-project");
    expect(line).toContain('"failed_step":"linear_project"');
    expect(line).toContain("repo_project_label");
  });

  it("creates repo label under the repo group parent", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient({}, calls);
    await createLinearProject(
      { env, requestId: "label-parent", caller: "test", linear },
      baseInput,
    );
    const labelCreate = calls.find((c) => c.query.includes("ProjectLabelCreate"));
    expect(labelCreate?.variables).toEqual({
      input: { name: "didi-build/demo-app", parentId: "group-repo-uuid" },
    });
  });

  it("never updates the idea issue and links with type related", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { labelExists: true, projectExists: true, kickoffExists: true, ideaIssue: true },
      calls,
    );
    await createLinearProject(
      { env, requestId: "idea-link", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    expect(calls.some((c) => /\bissueUpdate\b/i.test(c.query))).toBe(false);
    const relation = calls.find((c) => c.query.includes("IssueRelationCreate"));
    expect(relation?.variables).toEqual({
      input: {
        issueId: "kickoff-uuid",
        relatedIssueId: "idea-uuid",
        type: "related",
      },
    });
  });

  it("fails if idea relation type is not related", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      {
        labelExists: true,
        projectExists: true,
        kickoffExists: true,
        ideaIssue: true,
        ideaHasRelationToKickoff: true,
        ideaRelationType: "blocks",
      },
      calls,
    );
    await createLinearProject(
      { env, requestId: "idea-blocks", caller: "test", linear },
      { ...baseInput, idea_issue: "DIDI-830" },
    );
    expect(calls.some((c) => c.query.includes("IssueRelationCreate"))).toBe(true);
  });

  it("does not leak raw upstream text from HTTP 200 GraphQL errors in tool results", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { failGraphql200ErrorsOn: "query Teams" },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "no-raw-graphql-200", caller: "test", linear },
      baseInput,
    );
    expect(JSON.stringify(result)).not.toContain(LINEAR_RAW_GRAPHQL_200_LEAK_MARKER);
    expect(result).toMatchObject({ error: { code: "upstream_error" } });
  });

  it("does not leak raw upstream Linear error text in tool results", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { labelExists: true, failRead: "WorkflowStates" },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "no-raw-upstream", caller: "test", linear },
      baseInput,
    );
    const raw = "LINEAR_RAW_UPSTREAM_DO_NOT_LEAK_99441";
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(result).toMatchObject({ error: { code: "upstream_error" } });
  });

  it("returns conflict with zero writes when multiple kickoff epics share the marker", async () => {
    const calls: GraphqlCall[] = [];
    const linear = createHarnessClient(
      { labelExists: true, projectExists: true, kickoffDuplicateMarkers: true },
      calls,
    );
    const result = await createLinearProject(
      { env, requestId: "kickoff-dup-write", caller: "test", linear },
      baseInput,
    );
    expect(result).toMatchObject({
      error: { code: "conflict_not_factory_owned", step: "read_kickoff_epic" },
    });
    expect(resourceMutationCalls(calls)).toHaveLength(0);
  });

  it("dry_run returns conflict when multiple kickoff epics share the marker", async () => {
    const linear = createHarnessClient({
      labelExists: true,
      projectExists: true,
      kickoffDuplicateMarkers: true,
    });
    const result = await createLinearProject(
      { env, requestId: "kickoff-dup-dry", caller: "test", linear },
      { ...baseInput, dry_run: true },
    );
    expect(result).toMatchObject({ status: "conflict", dry_run: true });
  });

  const dryRunReadFailures: {
    failRead: string;
    step: string;
    warning: string;
    state?: HarnessState;
    discovery: {
      project_exists?: null;
      kickoff_epic_exists?: null;
      factory_owned?: null;
      repo_label_exists?: null;
      idea_issue_found?: null;
    };
  }[] = [
    {
      failRead: "query Teams",
      step: "read_linear_team",
      warning: "team read failed",
      discovery: {
        repo_label_exists: null,
        project_exists: null,
        factory_owned: null,
        kickoff_epic_exists: null,
      },
    },
    {
      failRead: "projectLabels",
      step: "read_project_labels",
      warning: "project label read failed",
      discovery: {
        repo_label_exists: null,
        project_exists: null,
        factory_owned: null,
        kickoff_epic_exists: null,
      },
    },
    {
      failRead: "ProjectsByLabel",
      step: "read_project_by_label",
      warning: "project read by label failed",
      state: { labelExists: true },
      discovery: {
        factory_owned: null,
        kickoff_epic_exists: null,
      },
    },
    {
      failRead: "ProjectsByName",
      step: "read_project_by_name",
      warning: "project read by name failed",
      discovery: {
        project_exists: null,
        factory_owned: null,
        kickoff_epic_exists: null,
      },
    },
    {
      failRead: "KickoffByMarker",
      step: "read_kickoff_epic",
      warning: "kickoff epic read failed",
      state: { labelExists: true, projectExists: true },
      discovery: { kickoff_epic_exists: null },
    },
    {
      failRead: "WorkflowStates",
      step: "read_workflow_state",
      warning: "workflow state read failed",
      discovery: { kickoff_epic_exists: null },
    },
    {
      failRead: "IssueById",
      step: "read_idea_issue",
      warning: "idea issue read failed",
      state: { labelExists: true, projectExists: true, ideaIssue: true },
      discovery: { idea_issue_found: null },
    },
  ];

  for (const scenario of dryRunReadFailures) {
    it(`dry_run records ${scenario.step} read failure`, async () => {
      const linear = createHarnessClient(
        { ...(scenario.state ?? {}), failRead: scenario.failRead },
        [],
      );
      const result = await createLinearProject(
        {
          env,
          requestId: `dry-fail-${scenario.step}`,
          caller: "test",
          linear,
        },
        {
          ...baseInput,
          dry_run: true,
          ...(scenario.step === "read_idea_issue" ? { idea_issue: "DIDI-830" } : {}),
        },
      );
      const planned = result as unknown as {
        warnings: string[];
        steps: { id: string; status: string }[];
        linear: Record<string, unknown>;
      };
      expect(
        planned.warnings.some((w) => w.toLowerCase().includes(scenario.warning)),
      ).toBe(true);
      expect(
        planned.steps.some((s) => s.id === scenario.step && s.status === "failed"),
      ).toBe(true);
      for (const [field, value] of Object.entries(scenario.discovery)) {
        expect(planned.linear[field]).toBe(value);
      }
    });
  }

  it("registers create_linear_project on the MCP server with validation and dry_run passthrough", async () => {
    const server = createFactoryMcpServer(env, "req-mcp", "mcp-caller");
    const tool = (
      server as unknown as {
        _registeredTools: {
          create_linear_project: {
            executor: (input: Record<string, unknown>) => Promise<unknown>;
            inputSchema: {
              parse: (input: Record<string, unknown>) => { dry_run: boolean };
            };
          };
        };
      }
    )._registeredTools.create_linear_project;
    expect(tool).toBeDefined();

    const parsed = tool.inputSchema.parse({
      name: "demo-app",
      display_name: "Demo App",
      summary: "A demo",
      approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
    });
    expect(parsed.dry_run).toBe(true);

    const spy = vi
      .spyOn(createLinearProjectModule, "createLinearProject")
      .mockResolvedValue({
        request_id: "req-mcp",
        status: "planned",
        dry_run: true,
        steps: [],
        warnings: [],
        project_url: null,
        project_label: "didi-build/demo-app",
        kickoff_epic: null,
        linear: { linear_read_ok: false },
      } as never);

    await tool.executor({
      name: "demo-app",
      display_name: "Demo App",
      summary: "A demo",
      approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
      dry_run: false,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-mcp", caller: "mcp-caller" }),
      expect.objectContaining({ dry_run: false }),
    );

    spy.mockRestore();
    const invalid = (await tool.executor({
      name: "demo-app",
      display_name: "",
      summary: "A demo",
      approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
    })) as { content: { text: string }[] };
    const payload = JSON.parse(String(invalid.content[0].text)) as {
      error?: { code: string };
    };
    expect(payload).toMatchObject({ error: { code: "invalid_input" } });
  });
});
