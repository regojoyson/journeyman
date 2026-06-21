import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getPreset, lintJsonSchema } from "@journeyman/webhooks";
import type { CreateWebhookArgs, PresetId, UpdateWebhookArgs, Webhook } from "@journeyman/core";
import type { Composition } from "@journeyman/api-context";
import { buildTestDeliveryHeaders, eventTypeHeaderForSample } from "../services/webhook-test-delivery.ts";
import { resolveWebhookSecret, secretRefFromAuth } from "../services/webhook-secret-lookup.ts";

function mintToken(): string { return randomBytes(24).toString("hex"); }

function ingestUrlFor(req: FastifyRequest, tenantToken: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  return `${proto}://${host}/webhooks/in/${tenantToken}`;
}

function withIngestUrl(req: FastifyRequest, w: Webhook): Webhook {
  return { ...w, ingestUrl: ingestUrlFor(req, w.tenantToken) };
}

type CreateBody = Omit<CreateWebhookArgs, "workspaceId" | "orgId">;

function validateCreateBody(body: unknown): CreateBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "missing_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name) return { error: "missing_name" };
  if (typeof b.preset !== "string") return { error: "missing_preset" };
  if (b.kind !== "ticket" && b.kind !== "git") return { error: "bad_kind" };
  if (!b.auth || typeof b.auth !== "object") return { error: "missing_auth" };
  if (b.payloadSchema !== undefined && b.payloadSchema !== null) {
    const lint = lintJsonSchema(b.payloadSchema);
    if (!lint.ok) return { error: `bad_schema: ${lint.errors.join("; ")}` };
  }
  return b as unknown as CreateBody;
}

export function registerWebhookManagementRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };

  app.get("/api/workspaces/:wsId/webhooks", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const list = await c.webhooks.listByWorkspace(wsId);
    return list.map((w) => withIngestUrl(req, w));
  });

  app.post("/api/workspaces/:wsId/webhooks", { ...write, config: { audit: { action: "webhook.create", targetType: "webhook" } } }, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;
    const v = validateCreateBody(req.body);
    if ("error" in v) return reply.code(400).send(v);
    const created = await c.webhooks.create(
      { ...v, workspaceId: wsId, orgId: ctx.workspace!.orgId },
      mintToken(),
    );
    req.auditTargetId = created.id;
    reply.code(201);
    return withIngestUrl(req, created);
  });

  /** Load a webhook and 404/403 unless the user's org owns it. */
  async function load(req: FastifyRequest, id: string): Promise<Webhook | { error: string; code: number }> {
    const w = await c.webhooks.getById(id);
    if (!w) return { error: "not_found", code: 404 };
    if (w.orgId !== req.runContext!.org.id) return { error: "forbidden", code: 403 };
    return w;
  }

  app.get("/api/webhooks/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    return withIngestUrl(req, r);
  });

  app.get("/api/webhooks/:id/events", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const q = req.query as { page?: string; page_size?: string };
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));
    const offset = (page - 1) * pageSize;
    const [events, total] = await Promise.all([
      c.webhookEvents.listByWebhook(id, { limit: pageSize, offset }),
      c.webhookEvents.countByWebhook(id),
    ]);
    return { events, total, page, pageSize };
  });

  app.patch("/api/webhooks/:id", { preHandler: requireAuth(), config: { audit: { action: "webhook.update", targetType: "webhook" } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const body = req.body as UpdateWebhookArgs;
    if (body?.payloadSchema !== undefined && body.payloadSchema !== null) {
      const lint = lintJsonSchema(body.payloadSchema);
      if (!lint.ok) return reply.code(400).send({ error: `bad_schema: ${lint.errors.join("; ")}` });
    }
    const updated = await c.webhooks.update(id, body);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return withIngestUrl(req, updated);
  });

  app.delete("/api/webhooks/:id", { preHandler: requireAuth(), config: { audit: { action: "webhook.delete", targetType: "webhook" } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const ok = await c.webhooks.delete(id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.post("/api/webhooks/:id/rotate", { preHandler: requireAuth(), config: { audit: { action: "webhook.rotate", targetType: "webhook" } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const newToken = mintToken();
    const updated = await c.webhooks.rotateToken(id, newToken);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return withIngestUrl(req, updated);
  });

  app.post("/api/webhooks/:id/test", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const body = (req.body ?? {}) as { sampleEvent?: string; payload?: unknown; eventType?: string };
    let payload: unknown = body.payload;
    if (payload === undefined && body.sampleEvent) {
      const preset = getPreset(r.preset as PresetId);
      payload = preset?.samples?.[body.sampleEvent];
      if (payload === undefined) return reply.code(400).send({ error: "no_such_sample" });
    }
    if (payload === undefined) return reply.code(400).send({ error: "no_payload" });
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const secretRef = secretRefFromAuth(r.auth);
    const resolvedSecret = c.pool
      ? await resolveWebhookSecret(c.pool, r.orgId, secretRef, r.workspaceId)
      : null;
    const headers = buildTestDeliveryHeaders(r, rawBody, resolvedSecret);
    if (!headers) return reply.code(501).send({ error: "auth_mode_not_synthesizable" });
    const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent ?? body.eventType);
    if (evtHeader) headers[evtHeader.name] = evtHeader.value;
    const injected = await app.inject({
      method: "POST",
      url: `/webhooks/in/${r.tenantToken}`,
      headers,
      payload: rawBody,
    });
    let parsed: unknown = injected.body;
    try { parsed = JSON.parse(injected.body); } catch { /* keep raw */ }
    reply.code(200);
    return { ingestStatus: injected.statusCode, ingestBody: parsed };
  });
}
