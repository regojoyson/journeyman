import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getAgent, runAgentGuarded, wasSkipped } from "@journeyman/agents";
import { audit } from "../services/audit.ts";

const TOKEN_PREFIX = "jm_agt_";

function newAgentToken(): { plaintext: string; hash: string } {
  const plaintext = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}
function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function ctxOf(req: FastifyRequest) {
  return req.runContext!;
}

export function registerAgentTriggerRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const pool = c.pool!;

  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };

  // Issue a per-agent API token (reveal once).
  app.post("/api/workspaces/:wsId/agents/:id/triggers/api-token", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const ctx = ctxOf(req);
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const { plaintext, hash } = newAgentToken();
    const { rows } = await pool.query(
      `INSERT INTO jm_agent_api_tokens (agent_id, org_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
      [id, agent.orgId, hash],
    );
    await audit(pool, { orgId: agent.orgId, actorUserId: ctx.user.id, action: "agent.token.issue", targetType: "agent", targetId: id, detail: { tokenId: rows[0].id } });
    reply.code(201);
    return { id: rows[0].id, token: plaintext }; // shown once
  });

  // List tokens (metadata only — never the plaintext). Includes revoked for audit trail.
  app.get("/api/workspaces/:wsId/agents/:id/triggers/api-token", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, name, last_used_at, created_at, disabled_at, revoked_at
        FROM jm_agent_api_tokens
        WHERE agent_id = $1
        ORDER BY created_at DESC`,
      [id],
    );
    return rows;
  });

  // Revoke a token (permanent).
  app.delete("/api/workspaces/:wsId/agents/:id/triggers/api-token/:tokenId", write, async (req, reply) => {
    const { wsId, id, tokenId } = req.params as { wsId: string; id: string; tokenId: string };
    const ctx = ctxOf(req);
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    await pool.query(`UPDATE jm_agent_api_tokens SET revoked_at = now() WHERE id = $1 AND agent_id = $2`, [tokenId, id]);
    await audit(pool, { orgId: agent.orgId, actorUserId: ctx.user.id, action: "agent.token.revoke", targetType: "agent", targetId: id, detail: { tokenId } });
    reply.code(204);
  });

  // Enable or disable a token (soft toggle — does not affect last_used_at).
  app.patch("/api/workspaces/:wsId/agents/:id/triggers/api-token/:tokenId", write, async (req, reply) => {
    const { wsId, id, tokenId } = req.params as { wsId: string; id: string; tokenId: string };
    const body = req.body as { disabled: boolean } | undefined;
    if (typeof body?.disabled !== "boolean") {
      reply.code(400).send({ error: "body must be { disabled: boolean }" });
      return;
    }
    const agent = await getAgent(pool, id);
    if (!agent || agent.workspaceId !== wsId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    await pool.query(
      `UPDATE jm_agent_api_tokens
        SET disabled_at = CASE WHEN $1 THEN now() ELSE NULL END
        WHERE id = $2 AND agent_id = $3 AND revoked_at IS NULL`,
      [body.disabled, tokenId, id],
    );
    reply.code(204);
  });

  // Fire — authenticated by the per-agent token (NOT the user session).
  app.post("/api/agents/:id/fire", async (req, reply) => {
    const { id } = req.params as { id: string };
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      reply.code(401);
      return { error: "missing_token" };
    }
    const tok = await pool.query(
      `SELECT id FROM jm_agent_api_tokens
        WHERE agent_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND disabled_at IS NULL`,
      [id, hashToken(bearer)],
    );
    if (!tok.rows[0]) {
      reply.code(401);
      return { error: "invalid_token" };
    }
    void pool.query(`UPDATE jm_agent_api_tokens SET last_used_at = now() WHERE id = $1`, [tok.rows[0].id]).catch(() => {});

    const agent = await getAgent(pool, id);
    if (!agent) {
      reply.code(404);
      return { error: "not_found" };
    }

    // Check that the API trigger is enabled (toggle = presence of { type: "api" } in triggers).
    const apiTriggerEnabled = agent.triggers.some((t) => t.type === "api");
    if (!apiTriggerEnabled) {
      reply.code(403);
      return { error: "api_trigger_disabled" };
    }

    if (!agent.enabled) {
      reply.code(202);
      return { status: "skipped_disabled" };
    }

    const idemKey = typeof req.headers["idempotency-key"] === "string" ? (req.headers["idempotency-key"] as string) : undefined;
    if (idemKey) {
      const dup = await pool.query(
        `SELECT workflow_instance_id FROM jm_agent_idempotency WHERE agent_id = $1 AND idempotency_key = $2`,
        [id, idemKey],
      );
      if (dup.rows[0]) {
        reply.code(202);
        return { workflowInstanceId: dup.rows[0].workflow_instance_id, deduped: true };
      }
    }

    const inputs = (req.body as Record<string, unknown> | undefined) ?? {};
    let res;
    try {
      res = await runAgentGuarded({ orchestrator: c.orchestrator, pool }, agent, inputs, "api", {
        userId: null,
        orgId: agent.orgId,
      });
    } catch (err: any) {
      reply.code(422);
      return { error: "invalid_inputs", message: err?.message ?? String(err) };
    }
    if (wasSkipped(res)) {
      reply.code(429);
      return { status: "skipped", reason: res.skipped };
    }
    if (idemKey) {
      await pool.query(
        `INSERT INTO jm_agent_idempotency (agent_id, idempotency_key, workflow_instance_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, idemKey, res.workflowInstanceId],
      );
    }
    reply.code(202);
    return { workflowInstanceId: res.workflowInstanceId, status: "queued" };
  });
}
