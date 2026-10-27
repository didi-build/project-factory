import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ProjectFactoryEnv } from "../env.js";
import { createLinearProject } from "../tools/create-linear-project.js";
import { createProjectRepo } from "../tools/create-project-repo.js";
import { projectStatus } from "../tools/project-status.js";

export function createFactoryMcpServer(
  env: ProjectFactoryEnv,
  requestId: string,
  caller: string,
): McpServer {
  const server = new McpServer({
    name: "project-factory",
    version: "0.1.0",
  });

  server.registerTool(
    "create_project_repo",
    {
      description:
        "Create or converge didi-build/<name> from the launchpad template with branch protection and standard labels",
      inputSchema: {
        name: z.string(),
        description: z.string().min(1).max(350),
        private: z.boolean().optional(),
        approval_ref: z.string().min(1),
        dry_run: z.boolean().optional(),
      },
    },
    async (input) => {
      const result = await createProjectRepo(
        { env, requestId, caller },
        {
          name: input.name,
          description: input.description,
          private: input.private,
          approval_ref: input.approval_ref,
          dry_run: input.dry_run,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "create_linear_project",
    {
      description:
        "Create or converge a Linear project on Didi Build with repo label, GitHub link, and kickoff epic",
      inputSchema: {
        name: z.string(),
        display_name: z.string().min(1),
        summary: z.string().min(1),
        idea_issue: z.string().optional(),
        approval_ref: z.string().min(1),
        dry_run: z.boolean().optional().default(true),
      },
    },
    async (input) => {
      const result = await createLinearProject(
        { env, requestId, caller },
        {
          name: input.name,
          display_name: input.display_name,
          summary: input.summary,
          idea_issue: input.idea_issue,
          approval_ref: input.approval_ref,
          dry_run: input.dry_run,
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    "project_status",
    {
      description:
        "Read-only GitHub status for a project name (Linear and Cloudflare not implemented yet)",
      inputSchema: {
        name: z.string(),
      },
    },
    async (input) => {
      const result = await projectStatus(env, requestId, caller, { name: input.name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}
