import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { AlreadyBootstrappedError } from "@journeyman/core";
import { bootstrap, isBootstrapped } from "../bootstrap.ts";

export async function registerBootstrapRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/bootstrap/status", async () => ({ bootstrapped: await isBootstrapped(pool) }));

  app.post("/api/bootstrap", async (req, reply) => {
    const body = req.body as {
      orgName?: string; orgSlug?: string;
      username?: string; password?: string; displayName?: string;
    };
    if (!body?.orgName || !body?.orgSlug || !body?.username || !body?.password) {
      return reply.code(400).send({ error: "Missing required fields" });
    }
    try {
      const out = await bootstrap(pool, {
        orgName: body.orgName, orgSlug: body.orgSlug,
        username: body.username, password: body.password, displayName: body.displayName,
      });
      reply.code(201);
      return out;
    } catch (err) {
      if (err instanceof AlreadyBootstrappedError) {
        return reply.code(403).send({ error: err.message });
      }
      throw err;
    }
  });
}
