import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import { getPreset, lintJsonSchema } from "@journeyman/webhooks";
import type {
  CreateWebhookArgs, PresetId, UpdateWebhookArgs, Webhook,
} from "@journeyman/core";
import type { Composition } from "../composition.ts";
import { buildTestDeliveryHeaders } from "../services/webhook-test-delivery.ts";
import {
  resolveWebhookSecret,
  secretRefFromAuth,
  secretExistsInOrgScope,
} from "../services/webhook-secret-lookup.ts";

function mintToken(): string {
  return randomBytes(24).toString("hex");
}

function ingestUrlFor(req: FastifyRequest, tenantToken: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  return `${proto}://${host}/webhooks/in/${tenantToken}`;
}

function withIngestUrl(req: FastifyRequest, w: Webhook): Webhook {
  return { ...w, ingestUrl: ingestUrlFor(req, w.tenantToken) };
}

type CreateBody = Omit<CreateWebhookArgs, "scope">;

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

  // ----- Org-scoped -------------------------------------------------------
  app.get("/api/orgs/:orgId/webhooks",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
      const list = await c.webhooks.listByScope({ orgId });
      return list.map((w) => withIngestUrl(req, w));
    });

  app.post("/api/orgs/:orgId/webhooks",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });
      const v = validateCreateBody(req.body);
      if ("error" in v) return reply.code(400).send(v);
      const created = await c.webhooks.create({ ...v, scope: { orgId } }, mintToken());
      reply.code(201);
      return withIngestUrl(req, created);
    });

  // ----- User-scoped ------------------------------------------------------
  app.get("/api/users/me/webhooks",
    { preHandler: requireAuth() },
    async (req) => {
      const userId = req.runContext!.user.id;
      const list = await c.webhooks.listByScope({ userId });
      return list.map((w) => withIngestUrl(req, w));
    });

  app.post("/api/users/me/webhooks",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const v = validateCreateBody(req.body);
      if ("error" in v) return reply.code(400).send(v);
      const userId = req.runContext!.user.id;
      const created = await c.webhooks.create({ ...v, scope: { userId } }, mintToken());
      reply.code(201);
      return withIngestUrl(req, created);
    });

  // ----- By-id (org or user) ----------------------------------------------
  async function load(req: FastifyRequest, id: string): Promise<Webhook | { error: string; code: number }> {
    const w = await c.webhooks.getById(id);
    if (!w) return { error: "not_found", code: 404 };
    const ctx = req.runContext!;
    const owned = ("orgId" in w.scope && w.scope.orgId === ctx.org.id) ||
                  ("userId" in w.scope && w.scope.userId === ctx.user.id);
    if (!owned) return { error: "forbidden", code: 403 };
    return w;
  }

  app.get("/api/webhooks/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(req, id);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });
      return withIngestUrl(req, r);
    });

  app.patch("/api/webhooks/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
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

  app.delete("/api/webhooks/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(req, id);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });
      const ok = await c.webhooks.delete(id);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    });

  app.post("/api/webhooks/:id/rotate",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(req, id);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });
      const newToken = mintToken();
      const updated = await c.webhooks.rotateToken(id, newToken);
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return withIngestUrl(req, updated);
    });

  app.post("/api/webhooks/:id/test",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(req, id);
      if ("error" in r) return reply.code(r.code).send({ error: r.error });

      const body = (req.body ?? {}) as { sampleEvent?: string; payload?: unknown };
      let payload: unknown = body.payload;
      if (payload === undefined && body.sampleEvent) {
        const preset = getPreset(r.preset as PresetId);
        payload = preset?.samples?.[body.sampleEvent];
        if (payload === undefined) return reply.code(400).send({ error: "no_such_sample" });
      }
      if (payload === undefined) return reply.code(400).send({ error: "no_payload" });

      const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
      const secretRef = secretRefFromAuth(r.auth);
      const resolvedSecret = c.pool ? await resolveWebhookSecret(c.pool, r.scope, secretRef) : null;
      const headers = buildTestDeliveryHeaders(r, rawBody, resolvedSecret);
      if (!headers) return reply.code(501).send({ error: "auth_mode_not_synthesizable" });

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

  // ----- Promote user-scope webhook → org-scope --------------------------
  app.post(
    "/api/orgs/:orgId/webhooks/:id/promote-from-user",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });

      // 1. Load the source webhook and confirm ownership + scope.
      const source = await c.webhooks.getById(id);
      if (!source) return reply.code(404).send({ error: "not_found" });
      if (!("userId" in source.scope) || source.scope.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "not_found_or_not_user_scope" });
      }

      // 2. Validate secret-ref (defense-in-depth; the dialog also checks).
      const refName = secretRefFromAuth(source.auth);
      if (refName) {
        if (!c.pool) return reply.code(500).send({ error: "no_pool_for_secret_check" });
        const ok = await secretExistsInOrgScope(c.pool, orgId, refName);
        if (!ok) {
          return reply.code(400).send({
            error: "secret_not_in_org_scope",
            unresolved: [refName],
          });
        }
      }

      // 3. Clone the row into org-scope with a new tenantToken.
      try {
        const created = await c.webhooks.create(
          {
            scope: { orgId },
            name: source.name,
            description: source.description,
            preset: source.preset,
            kind: source.kind,
            auth: source.auth,
            payloadSchema: source.payloadSchema,
            schemaValidation: source.schemaValidation,
            schemaInferredFrom: source.schemaInferredFrom,
            eventTypePath: source.eventTypePath,
            deliveryIdHeader: source.deliveryIdHeader,
            correlationSuggestions: source.correlationSuggestions,
          },
          mintToken(),
        );
        reply.code(201);
        return withIngestUrl(req, created);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: msg });
      }
    },
  );
}
