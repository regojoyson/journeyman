import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerWorkspaceMcpRoutes } from "./workspace-mcp.ts";
import { registerMcpCatalogRoute } from "./catalog.ts";

export async function registerMcpRoutes(app: FastifyInstance, pool: Pool) {
  await registerWorkspaceMcpRoutes(app, pool);
  await registerMcpCatalogRoute(app);
}
