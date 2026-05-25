import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { DuplicateSecretError, fetchOwnUserSecret, insertOrgSecret } from "../db.ts";

export async function registerPromoteSecretRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post(
    "/api/orgs/:orgId/secrets/:secretName/promote-from-user",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, secretName } = req.params as { orgId: string; secretName: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) {
        return reply.code(403).send({ error: "Wrong org" });
      }

      // 1. Find the caller's user-scope secret by name.
      let value: string | null;
      try {
        value = await fetchOwnUserSecret(pool, ctx.user.id, secretName);
      } catch (err) {
        if (err instanceof Error && /Invalid secret name/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      if (value === null) {
        return reply.code(404).send({
          error: `No personal secret named '${secretName}' to promote`,
        });
      }

      // 2. Insert into org-scope. Existing helper enforces the unique
      //    constraint and throws DuplicateSecretError on collision.
      try {
        const rec = await insertOrgSecret(pool, {
          orgId,
          name: secretName,
          value,
          description: `Promoted from personal secret by ${ctx.user.id}`,
          createdBy: ctx.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name };
      } catch (err) {
        if (err instanceof DuplicateSecretError) {
          return reply.code(409).send({
            error: `Org-scope secret '${secretName}' already exists`,
          });
        }
        throw err;
      }
    },
  );
}
