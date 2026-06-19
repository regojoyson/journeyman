import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { DuplicateSecretError, fetchPinnedWorkspaceSecret, insertOrgSecret } from "../db.ts";

export async function registerPromoteSecretRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });

  app.post(
    "/api/workspaces/:wsId/secrets/:secretName/promote-to-org",
    { preHandler: [requireAuth(), requirePerm("members.manage")] },
    async (req, reply) => {
      const { wsId, secretName } = req.params as { wsId: string; secretName: string };
      const ctx = req.runContext!;

      // 1. Find the workspace-scope secret by name.
      let value: string | null;
      try {
        value = await fetchPinnedWorkspaceSecret(pool, wsId, secretName);
      } catch (err) {
        if (err instanceof Error && /Invalid secret name/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      if (value === null) {
        return reply.code(404).send({
          error: `No workspace secret named '${secretName}' to promote`,
        });
      }

      // 2. Insert into org-scope. Existing helper enforces the unique
      //    constraint and throws DuplicateSecretError on collision.
      try {
        const rec = await insertOrgSecret(pool, {
          orgId: ctx.workspace!.orgId,
          name: secretName,
          value,
          description: `Promoted from workspace ${wsId} by ${ctx.user.id}`,
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
