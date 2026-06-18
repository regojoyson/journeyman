import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth } from "@journeyman/identity";
import { getAgent, runAgentGuarded, wasSkipped } from "@journeyman/agents";

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
  const pool = c.pool!;

  const wrongOrg = (ctx: { org: { id: string } }, orgId: string, reply: FastifyReply) =>
    ctx.org.id !== orgId ? (reply.code(403).send({ error: "wrong_org" }), true) : false;

  // Issue a per-agent API token (reveal once).
  app.post("/api/orgs/:orgId/agents/:id/triggers/api-token", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const agent = await getAgent(pool, id);
    if (!agent || agent.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const { plaintext, hash } = newAgentToken();
    const { rows } = await pool.query(
      `INSERT INTO jm_agent_api_tokens (agent_id, org_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
      [id, orgId, hash],
    );
    reply.code(201);
    return { id: rows[0].id, token: plaintext }; // shown once
  });

  // List tokens (metadata only — never the plaintext).
  app.get("/api/orgs/:orgId/agents/:id/triggers/api-token", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const { rows } = await pool.query(
      `SELECT id, name, last_used_at, created_at FROM jm_agent_api_tokens
        WHERE agent_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [id],
    );
    return rows;
  });

  // Revoke a token.
  app.delete("/api/orgs/:orgId/agents/:id/triggers/api-token/:tokenId", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id, tokenId } = req.params as { orgId: string; id: string; tokenId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    await pool.query(`UPDATE jm_agent_api_tokens SET revoked_at = now() WHERE id = $1 AND agent_id = $2`, [tokenId, id]);
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
      `SELECT id FROM jm_agent_api_tokens WHERE agent_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
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
