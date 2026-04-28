import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerAuthRoutes } from "./auth.ts";
import { registerBootstrapRoutes } from "./bootstrap.ts";
import { registerOrgRoutes } from "./orgs.ts";
import { registerUserRoutes } from "./users.ts";
import { registerApiTokenRoutes } from "./api-tokens.ts";

export async function registerIdentityRoutes(app: FastifyInstance, pool: Pool) {
  await registerBootstrapRoutes(app, pool);
  await registerAuthRoutes(app, pool);
  await registerOrgRoutes(app, pool);
  await registerUserRoutes(app, pool);
  await registerApiTokenRoutes(app, pool);
}

export { makeRequireAuth } from "../middleware.ts";
