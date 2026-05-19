import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  CANONICAL_TOOLS, isCanonicalTool, isValidCustomPhaseIcon,
  type CanonicalTool, type SecretSlotDef,
} from "@journeyman/core";
import {
  DuplicateCustomPhaseError,
  deleteCustomAiPhase,
  getCustomAiPhase,
  listCustomAiPhases,
  updateCustomAiPhase,
} from "../db.ts";
import { toExportV1 } from "../export.ts";
import { assertScopeSafeDefaults, ScopeViolationError } from "../scope-guard.ts";
import { buildScopeLookup } from "../scope-lookup.ts";

function formatScopeError(err: ScopeViolationError): string {
  const list = err.offenders.map(o => `${o.kind} '${o.id}' (${o.scope}-scoped)`).join(", ");
  return `Cannot save: defaults reference scope-incompatible resources — ${list}. ` +
         `Either promote those resources or remove them from the defaults.`;
}

const SLOT_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
const RESERVED_SLOT_NAMES = new Set(["PATH", "HOME", "USER", "SHELL", "PWD"]);

function parseSlots(raw: unknown): SecretSlotDef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("slots must be an array");
  const seen = new Set<string>();
  const out: SecretSlotDef[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") throw new Error("slots[].entry must be an object");
    const name = (s as any).name;
    const description = (s as any).description;
    const optional = (s as any).optional;
    if (typeof name !== "string" || !SLOT_NAME_REGEX.test(name)) {
      throw new Error(`slots[].name must match SCREAMING_SNAKE_CASE: '${String(name)}'`);
    }
    if (name.startsWith("JM_")) {
      throw new Error(`slots[].name must not start with 'JM_': '${name}'`);
    }
    if (RESERVED_SLOT_NAMES.has(name)) {
      throw new Error(`slots[].name shadows a reserved env variable: '${name}'`);
    }
    if (seen.has(name)) throw new Error(`slots contains duplicate name '${name}'`);
    seen.add(name);
    if (typeof description !== "string" || description.trim() === "") {
      throw new Error(`slots[${name}].description is required`);
    }
    if (optional !== undefined && typeof optional !== "boolean") {
      throw new Error(`slots[${name}].optional must be a boolean`);
    }
    out.push(optional ? { name, description, optional: true } : { name, description });
  }
  return out;
}

function parseIcon(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (!isValidCustomPhaseIcon(raw)) {
    throw new Error("icon must be null or 'lucide:<AllowlistedName>'");
  }
  return (raw ?? null) as string | null;
}

function parseDefaultTools(raw: unknown): CanonicalTool[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("defaultTools must be an array of canonical tool names");
  }
  const seen = new Set<string>();
  for (const t of raw) {
    if (!isCanonicalTool(t)) {
      throw new Error(
        `defaultTools contains invalid tool '${String(t)}'. Allowed: ${CANONICAL_TOOLS.join(", ")}`,
      );
    }
    if (seen.has(t)) throw new Error(`defaultTools contains duplicate '${t}'`);
    seen.add(t);
  }
  return raw as CanonicalTool[];
}

export async function registerOrgCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listCustomAiPhases(pool, orgId, null);
    },
  );

  app.get(
    "/api/orgs/:orgId/custom-phases/:id/export",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) {
        return reply.code(403).send({ error: "Wrong org" });
      }
      const rec = await getCustomAiPhase(pool, id);
      if (!rec || rec.orgId !== orgId || rec.scope !== "org") {
        return reply.code(404).send({ error: "Not found" });
      }
      const payload = toExportV1(rec);
      const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "custom-phase";
      reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${slug}.json"`);
      return payload;
    },
  );

  app.patch(
    "/api/orgs/:orgId/custom-phases/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.scope !== "org") {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        const patchBody = req.body as any;
        const patch = {
          ...patchBody,
          ...(patchBody?.icon !== undefined
            ? { icon: parseIcon(patchBody.icon) }
            : {}),
          ...(patchBody?.defaultTools !== undefined
            ? { defaultTools: parseDefaultTools(patchBody.defaultTools) }
            : {}),
          ...(patchBody?.slots !== undefined
            ? { slots: parseSlots(patchBody.slots) }
            : {}),
        };
        const skillIds = patch.defaultSkillIds ?? existing.defaultSkillIds;
        const mcpIds   = patch.defaultMcpIds   ?? existing.defaultMcpIds;
        try {
          await assertScopeSafeDefaults({
            phaseScope: "org",
            defaultSkillIds: skillIds,
            defaultMcpIds: mcpIds,
            lookup: buildScopeLookup(pool),
          });
        } catch (e) {
          if (e instanceof ScopeViolationError) return reply.code(400).send({ error: formatScopeError(e) });
          throw e;
        }
        return await updateCustomAiPhase(pool, id, patch);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /^(icon|defaultTools|slots)/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/custom-phases/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.scope !== "org") {
        return reply.code(404).send({ error: "Not found" });
      }
      await deleteCustomAiPhase(pool, id);
      reply.code(204);
      return null;
    },
  );
}
