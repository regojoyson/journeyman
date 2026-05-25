import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgSecretRoutes } from "./org-secrets.ts";
import { registerUserSecretRoutes } from "./user-secrets.ts";
import { registerGlobalSecretRoutes } from "./global-secrets.ts";
import { registerResolveRoutes } from "./resolve.ts";
import { registerVisibleNamesRoutes } from "./visible-names.ts";
import { registerPromoteSecretRoute } from "./promote.ts";

export async function registerSecretsRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSecretRoutes(app, pool);
  await registerUserSecretRoutes(app, pool);
  await registerGlobalSecretRoutes(app, pool);
  await registerResolveRoutes(app, pool);
  await registerVisibleNamesRoutes(app, pool);
  await registerPromoteSecretRoute(app, pool);
}
