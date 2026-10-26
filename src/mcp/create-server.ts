import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ProjectFactoryEnv } from "../env.js";
import { createProjectRepo } from "../tools/create-project-repo.js";
import { provisionCloudflare } from "../tools/provision-cloudflare.js";
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
    "provision_cloudflare",
    {
      description:
        "Create or converge Cloudflare Workers and GitHub deploy secrets for a factory-owned repo",
      inputSchema: {
        name: z.string(),
        approval_ref: z.string().min(1),
        dry_run: z.boolean().optional(),
      },
    },
    async (input) => {
      const result = await provisionCloudflare(
        { env, requestId, caller },
        {
          name: input.name,
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
