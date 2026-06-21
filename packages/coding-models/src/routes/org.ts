import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CodingModelConfig } from "@journeyman/core";
import { canAccessOrg } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { getOrgSecretMeta } from "@journeyman/secrets";
import {
  DuplicateCodingModelError,
  deleteCodingModel,
  getCodingModel,
  insertCodingModel,
  listCodingModelsByOrg,
  updateCodingModel,
} from "../db.ts";
import { isValidCodingProvider, LIST_CODING_PROVIDERS } from "../validate-provider.ts";
import { validateCodingModelConfig } from "../validate-config.ts";
import { upsertActivePrice } from "../pricing-db.ts";

/**
 * Validate the secret binding: when config.requiresApiKey is set the model needs a key,
 * so api_key_secret_id must reference a real org secret in this org. Returns an error
 * message, or null.
 */
async function validateBinding(
  pool: Pool,
  orgId: string,
  config: CodingModelConfig | undefined,
  apiKeySecretId: string | undefined | null,
): Promise<string | null> {
  const needsKey = Boolean(config?.requiresApiKey);
  if (needsKey) {
    if (!apiKeySecretId) return "apiKeySecretId is required when the model requires an API key";
    const meta = await getOrgSecretMeta(pool, orgId, apiKeySecretId);
    if (!meta) return "apiKeySecretId must reference an org secret in this org";
  }
  return null;
}

export async function registerOrgCodingModelRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/coding-models",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      return listCodingModelsByOrg(pool, orgId);
    },
  );

  app.post(
    "/api/orgs/:orgId/coding-models",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.create", targetType: "coding_model" } } },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      const b = req.body as any;
      if (!b?.provider || !b?.modelId || !b?.label) {
        return reply.code(400).send({ error: "provider, modelId, label required" });
      }
      if (!isValidCodingProvider(b.provider)) {
        return reply.code(400).send({
          error: `Unknown coding-cli provider: ${b.provider}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
        });
      }
      const cfgErr = validateCodingModelConfig(String(b.provider), b.config);
      if (cfgErr) return reply.code(400).send({ error: cfgErr });
      const bindErr = await validateBinding(pool, orgId, b.config, b.apiKeySecretId);
      if (bindErr) return reply.code(400).send({ error: bindErr });
      try {
        const rec = await insertCodingModel(pool, orgId, {
          provider: String(b.provider),
          modelId: String(b.modelId),
          label: String(b.label),
          description: b.description,
          sortOrder: b.sortOrder,
          enabled: b.enabled,
          deprecated: b.deprecated,
          isDefault: b.isDefault,
          supportsThinking: b.supportsThinking,
          contextWindow: b.contextWindow,
          config: b.config,
          apiKeySecretId: b.apiKeySecretId,
        });
        await upsertActivePrice(pool, orgId, rec.provider, rec.modelId, b.pricing);
        req.auditTargetId = rec.id;
        req.auditDetail = { label: rec.label };
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId/coding-models/:id",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.update", targetType: "coding_model" } } },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCodingModel(pool, orgId, id);
      if (!existing) return reply.code(404).send({ error: "Not found" });
      const patch = req.body as Record<string, unknown> | undefined;
      const effectiveProvider =
        typeof patch?.provider === "string" ? (patch.provider as string) : existing.provider;
      if (patch && Object.prototype.hasOwnProperty.call(patch, "provider")) {
        if (!isValidCodingProvider(patch.provider)) {
          return reply.code(400).send({
            error: `Unknown coding-cli provider: ${String(patch.provider)}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
          });
        }
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "config")) {
        const cfgErr = validateCodingModelConfig(
          effectiveProvider,
          patch.config as CodingModelConfig | undefined,
        );
        if (cfgErr) return reply.code(400).send({ error: cfgErr });
      }
      // Validate the binding against the effective (post-patch) config + secret id.
      const effConfig = patch && Object.prototype.hasOwnProperty.call(patch, "config")
        ? (patch.config as CodingModelConfig | undefined)
        : existing.config;
      const effSecretId = patch && Object.prototype.hasOwnProperty.call(patch, "apiKeySecretId")
        ? (patch.apiKeySecretId as string | undefined)
        : existing.apiKeySecretId;
      const bindErr = await validateBinding(pool, orgId, effConfig, effSecretId);
      if (bindErr) return reply.code(400).send({ error: bindErr });
      try {
        const updated = await updateCodingModel(pool, orgId, id, req.body as any);
        if (updated) {
          await upsertActivePrice(
            pool, orgId, updated.provider, updated.modelId,
            (req.body as { pricing?: import("@journeyman/core").ModelPriceInput }).pricing,
          );
        }
        return updated;
      } catch (err) {
        if (err instanceof DuplicateCodingModelError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/coding-models/:id",
    { preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.delete", targetType: "coding_model" } } },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (!canAccessOrg(req.runContext!, orgId)) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteCodingModel(pool, orgId, id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      reply.code(204);
      return null;
    },
  );
}
