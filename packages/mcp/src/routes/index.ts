import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserMcpRoutes } from "./user-mcp.ts";
import { registerOrgMcpRoutes } from "./org-mcp.ts";
import { registerVisibleMcpRoutes } from "./visible.ts";
import { registerMcpCatalogRoute } from "./catalog.ts";
import { registerPromoteMcpRoute } from "./promote.ts";
import { registerPromotableMcpRoute } from "./promotable.ts";
import { registerMcpTestRoutes } from "./test-mcp.ts";

export async function registerMcpRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgMcpRoutes(app, pool);
  await registerUserMcpRoutes(app, pool);
  await registerVisibleMcpRoutes(app, pool);
  await registerMcpCatalogRoute(app);
  await registerPromoteMcpRoute(app, pool);
  await registerPromotableMcpRoute(app, pool);
  await registerMcpTestRoutes(app, pool);
}
