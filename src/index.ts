import { createMcpHandler } from "agents/mcp/server";
import { authorizeBearer, factoryCaller } from "./auth/bearer.js";
import type { ProjectFactoryEnv } from "./env.js";
import { createFactoryMcpServer } from "./mcp/create-server.js";

export default {
  async fetch(
    request: Request,
    env: ProjectFactoryEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (!(await authorizeBearer(request, env))) {
      return new Response(null, { status: 401 });
    }

    const requestId = crypto.randomUUID();
    const caller = factoryCaller(request);
    const handler = createMcpHandler(() =>
      createFactoryMcpServer(env, requestId, caller),
    );
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<ProjectFactoryEnv>;
