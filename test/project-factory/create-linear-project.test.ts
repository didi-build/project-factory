import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectFactoryEnv } from "../../src/env.js";
import { emptyProductDirectionBlock } from "../../src/factory/linear-content.js";
import { createLinearProject } from "../../src/tools/create-linear-project.js";
import {
  buildLinearApiKey,
  createMockLinearClient,
  isLinearMutation,
  type RecordedLinearCall,
} from "./linear-mock.js";

const env: ProjectFactoryEnv = {
  PROJECT_FACTORY_GH_APP_ID: "5471521",
  PROJECT_FACTORY_GH_INSTALLATION_ID: "175254357",
  PROJECT_FACTORY_GH_ORG: "didi-build",
  PROJECT_FACTORY_TEMPLATE_REPO: "didi-build/launchpad",
  PROJECT_FACTORY_LINEAR_TEAM: "Didi Build",
};

const TEAM_ID = "cff86df5-36a6-4c6a-8527-7ef0bee09c1e";
const REPO_GROUP_ID = "group-repo-uuid";
const LABEL_ID = "label-demo-uuid";
const PROJECT_ID = "project-demo-uuid";
const STATE_ID = "state-cto-uuid";
const KICKOFF_ID = "kickoff-uuid";
const IDEA_ID = "idea-uuid";

const EXPECTED_LABEL_CREATE_INPUT = {
  input: {
    name: "didi-build/demo-app",
    parentId: REPO_GROUP_ID,
  },
};

const EXPECTED_PROJECT_CREATE_INPUT = {
  input: {
    name: "Demo App",
    teamIds: [TEAM_ID],
    description: expect.stringContaining("<!-- project-factory:demo-app -->"),
    labelIds: [LABEL_ID],
  },
};

const EXPECTED_ISSUE_CREATE_INPUT = {
  input: {
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: "Demo App: kickoff",
    description: emptyProductDirectionBlock(),
    stateId: STATE_ID,
  },
};

const EXPECTED_GITHUB_LINK_INPUT = {
  input: {
    projectId: PROJECT_ID,
    url: "https://github.com/didi-build/demo-app",
    label: "GitHub",
  },
};

const EXPECTED_RELATION_INPUT = {
  input: {
    issueId: KICKOFF_ID,
    relatedIssueId: IDEA_ID,
    type: "related",
  },
};

function labelsQueryResponse(labelExists: boolean) {
  const nodes: {
    id: string;
    name: string;
    isGroup: boolean;
    parent: { id: string; name: string } | null;
  }[] = [{ id: REPO_GROUP_ID, name: "repo", isGroup: true, parent: null }];
  if (labelExists) {
    nodes.push({
      id: LABEL_ID,
      name: "didi-build/demo-app",
      isGroup: false,
      parent: { id: REPO_GROUP_ID, name: "repo" },
    });
  }
  return { projectLabels: { nodes } };
}

function emptyProjects() {
  return { projects: { nodes: [] } };
}

function existingProject(marker = true) {
  return {
    projects: {
      nodes: [
        {
          id: PROJECT_ID,
          name: "Demo App",
          url: "https://linear.app/didi-build/project/demo",
          description: marker
            ? "Summary\n\nGitHub: https://github.com/didi-build/demo-app\n\n<!-- project-factory:demo-app -->"
            : "Someone else's project",
          labels: { nodes: [{ id: LABEL_ID, name: "didi-build/demo-app" }] },
          externalLinks: {
            nodes: [
              {
                id: "link-1",
                url: "https://github.com/didi-build/demo-app",
                label: "GitHub",
              },
            ],
          },
        },
      ],
    },
  };
}

function workflowState() {
  return {
    workflowStates: { nodes: [{ id: STATE_ID, name: "Ready for CTO breakdown" }] },
  };
}

function kickoffIssue(relations: unknown[] = []) {
  return {
    issues: {
      nodes: [
        {
          id: KICKOFF_ID,
          identifier: "DIDI-900",
          title: "Demo App: kickoff",
          url: "https://linear.app/didi-build/issue/DIDI-900",
          description: emptyProductDirectionBlock(),
          state: { id: STATE_ID, name: "Ready for CTO breakdown" },
          relations: { nodes: relations },
        },
      ],
    },
  };
}

function routeLinear(
  state: {
    labelExists?: boolean;
    projectExists?: boolean;
    factoryMarker?: boolean;
    kickoffExists?: boolean;
    ideaIssue?: boolean;
  },
  calls: RecordedLinearCall[],
) {
  return createMockLinearClient((call) => {
    const q = call.query;
    if (q.includes("projectLabels")) {
      return { ok: true, data: labelsQueryResponse(state.labelExists ?? false) };
    }
    if (q.includes("ProjectsByLabel") || q.includes("ProjectsByName")) {
      if (state.projectExists) {
        return { ok: true, data: existingProject(state.factoryMarker ?? true) };
      }
      return { ok: true, data: emptyProjects() };
    }
    if (q.includes("WorkflowStates")) {
      return { ok: true, data: workflowState() };
    }
    if (q.includes("IssuesInProject")) {
      if (state.kickoffExists) {
        return { ok: true, data: kickoffIssue() };
      }
      return { ok: true, data: { issues: { nodes: [] } } };
    }
    if (q.includes("IssueById")) {
      if (state.ideaIssue) {
        return {
          ok: true,
          data: {
            issue: {
              id: IDEA_ID,
              identifier: "DIDI-830",
              title: "Idea",
              url: "https://linear.app/didi-build/issue/DIDI-830",
              state: { id: "idea-state", name: "Backlog" },
            },
          },
        };
      }
      return { ok: true, data: { issue: null } };
    }
    if (q.includes("ProjectLabelCreate")) {
      return {
        ok: true,
        data: {
          projectLabelCreate: {
            success: true,
            projectLabel: { id: LABEL_ID, name: "didi-build/demo-app" },
          },
        },
      };
    }
    if (q.includes("ProjectCreate")) {
      return {
        ok: true,
        data: {
          projectCreate: {
            success: true,
            project: {
              id: PROJECT_ID,
              name: "Demo App",
              url: "https://linear.app/didi-build/project/demo",
              description: "new",
            },
          },
        },
      };
    }
    if (q.includes("EntityExternalLinkCreate")) {
      return { ok: true, data: { entityExternalLinkCreate: { success: true } } };
    }
    if (q.includes("IssueCreate")) {
      return {
        ok: true,
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: KICKOFF_ID,
              identifier: "DIDI-900",
              title: "Demo App: kickoff",
              url: "https://linear.app/didi-build/issue/DIDI-900",
              state: { id: STATE_ID, name: "Ready for CTO breakdown" },
            },
          },
        },
      };
    }
    if (q.includes("IssueRelationCreate")) {
      return { ok: true, data: { issueRelationCreate: { success: true } } };
    }
    if (q.includes("IssueUpdate")) {
      calls.push({ query: "UNEXPECTED_ISSUE_UPDATE", variables: call.variables });
      return { ok: true, data: { issueUpdate: { success: true } } };
    }
    return { ok: false, error: { status: 500, message: "unmocked", retryable: false } };
  }, calls);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLinearProject", () => {
  it("dry_run performs Linear reads only (no mutations)", async () => {
    const calls: RecordedLinearCall[] = [];
    const apiKey = buildLinearApiKey();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const linear = routeLinear({ labelExists: false, projectExists: false }, calls);

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: apiKey },
        requestId: "req-dry",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );

    expect(result).toMatchObject({ status: "planned", dry_run: true });
    const mutations = calls.filter((c) => isLinearMutation(c.query));
    expect(mutations).toHaveLength(0);

    const serialized = JSON.stringify(result);
    const auditLine = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(serialized).not.toContain(apiKey);
    expect(auditLine).not.toContain(apiKey);
  });

  it("creates label, project, link, and kickoff epic", async () => {
    const calls: RecordedLinearCall[] = [];
    const linear = routeLinear(
      { labelExists: false, projectExists: false, kickoffExists: false },
      calls,
    );

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-create",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({
      status: "created",
      project_label: "didi-build/demo-app",
      kickoff_epic: { identifier: "DIDI-900" },
    });

    const labelCreate = calls.find((c) => c.query.includes("ProjectLabelCreate"));
    expect(labelCreate?.variables).toEqual(EXPECTED_LABEL_CREATE_INPUT);

    const projectCreate = calls.find((c) => c.query.includes("ProjectCreate"));
    expect(projectCreate?.variables).toMatchObject(EXPECTED_PROJECT_CREATE_INPUT);

    const linkCreate = calls.find((c) => c.query.includes("EntityExternalLinkCreate"));
    expect(linkCreate?.variables).toEqual(EXPECTED_GITHUB_LINK_INPUT);

    const issueCreate = calls.find((c) => c.query.includes("IssueCreate"));
    expect(issueCreate?.variables).toEqual(EXPECTED_ISSUE_CREATE_INPUT);
  });

  it("is idempotent on rerun", async () => {
    const calls: RecordedLinearCall[] = [];
    const linear = routeLinear(
      { labelExists: true, projectExists: true, kickoffExists: true },
      calls,
    );

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-exists",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ status: "exists" });
    expect(calls.filter((c) => isLinearMutation(c.query))).toHaveLength(0);
  });

  it("relates kickoff epic to idea_issue when given", async () => {
    const calls: RecordedLinearCall[] = [];
    const linear = routeLinear(
      {
        labelExists: false,
        projectExists: false,
        kickoffExists: false,
        ideaIssue: true,
      },
      calls,
    );

    await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-idea",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        idea_issue: "DIDI-830",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    const relation = calls.find((c) => c.query.includes("IssueRelationCreate"));
    expect(relation?.variables).toEqual(EXPECTED_RELATION_INPUT);
  });

  it("never updates idea_issue status", async () => {
    const calls: RecordedLinearCall[] = [];
    const linear = routeLinear(
      {
        labelExists: false,
        projectExists: false,
        kickoffExists: false,
        ideaIssue: true,
      },
      calls,
    );

    await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-no-idea-update",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        idea_issue: "DIDI-830",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    const issueUpdates = calls.filter((c) => c.query.includes("IssueUpdate"));
    for (const update of issueUpdates) {
      const id = (update.variables as { id?: string })?.id;
      expect(id).not.toBe(IDEA_ID);
    }
  });

  it("rejects invalid names without Linear calls", async () => {
    const linear = createMockLinearClient(() => {
      throw new Error("Linear must not be called");
    });

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-invalid",
        caller: "test",
        linear,
      },
      {
        name: "ab",
        display_name: "Demo",
        summary: "x",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ error: { code: "invalid_name" } });
  });

  it("returns missing_secret when the Linear key is absent on write", async () => {
    const result = await createLinearProject(
      {
        env,
        requestId: "req-missing",
        caller: "test",
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({
      error: { code: "missing_secret", message: "PROJECT_FACTORY_LINEAR_API_KEY" },
    });
  });

  it("maps Linear auth errors to permission_denied", async () => {
    const linear = createMockLinearClient(() => ({
      ok: false,
      error: {
        status: 401,
        code: "permission_denied",
        message: "authentication required",
        retryable: false,
      },
    }));

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-auth",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: false,
      },
    );

    expect(result).toMatchObject({ error: { code: "permission_denied" } });
  });

  it("dry_run reports read failures as warnings without treating them as missing resources", async () => {
    const linear = createMockLinearClient((call) => {
      if (call.query.includes("projectLabels")) {
        return {
          ok: false,
          error: { status: 502, message: "bad gateway", retryable: true },
        };
      }
      return { ok: true, data: emptyProjects() };
    });

    const result = await createLinearProject(
      {
        env: { ...env, PROJECT_FACTORY_LINEAR_API_KEY: buildLinearApiKey() },
        requestId: "req-read-fail",
        caller: "test",
        linear,
      },
      {
        name: "demo-app",
        display_name: "Demo App",
        summary: "A demo",
        approval_ref: "https://linear.app/didi-build/issue/DIDI-1",
        dry_run: true,
      },
    );

    expect(result).toMatchObject({
      status: "planned",
      dry_run: true,
      linear: { linear_read_ok: false },
    });
    const planned = result as unknown as {
      warnings: string[];
      linear: { project_exists: boolean | null };
    };
    expect(planned.warnings[0]).toContain("read failed");
    expect(planned.linear.project_exists).toBeNull();
  });
});
