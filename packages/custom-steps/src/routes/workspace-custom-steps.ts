import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import {
  CANONICAL_TOOLS, isCanonicalTool, isValidCustomStepIcon,
  type CanonicalTool, type SecretSlotDef,
} from "@journeyman/core";
import {
  DuplicateCustomStepError,
  deleteCustomAiStep,
  disableCustomAiStep,
  enableCustomAiStep,
  getCustomAiStep,
  insertCustomAiStep,
  listCustomAiSteps,
  listEnabledCustomAiSteps,
  updateCustomAiStep,
} from "../db.ts";
import { toExportV1, fromExportV1, CustomStepImportError } from "../export.ts";
import { checkCustomStepReadiness } from "../readiness.ts";

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
  if (!isValidCustomStepIcon(raw)) {
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

export async function registerWorkspaceCustomStepRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const requirePerm = makeRequireWorkspacePermission({ pool });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };
  const del = { preHandler: [requireAuth(), requirePerm("resource.delete")] };

  // GET /api/workspaces/:wsId/custom-steps
  app.get("/api/workspaces/:wsId/custom-steps", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listCustomAiSteps(pool, wsId);
  });

  // GET /api/workspaces/:wsId/custom-steps/visible (for flow-editor palette)
  app.get("/api/workspaces/:wsId/custom-steps/visible", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listEnabledCustomAiSteps(pool, wsId);
  });

  // POST /api/workspaces/:wsId/custom-steps
  app.post("/api/workspaces/:wsId/custom-steps", write, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;
    const body = req.body as any;
    try {
      const rec = await insertCustomAiStep(pool, {
        workspaceId: wsId,
        createdBy: ctx.user.id,
        name: body.name,
        description: body.description,
        icon: parseIcon(body.icon) ?? null,
        inputFields: body.inputFields,
        outputMode: body.outputMode,
        outputFields: body.outputFields,
        promptTemplate: body.promptTemplate,
        defaultTools: parseDefaultTools(body.defaultTools),
        defaultMcpIds: body.defaultMcpIds,
        defaultSkillIds: body.defaultSkillIds,
        requiresSkills: typeof body.requiresSkills === "boolean" ? body.requiresSkills : false,
        requiresMcp: typeof body.requiresMcp === "boolean" ? body.requiresMcp : false,
        slots: parseSlots(body.slots),
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof DuplicateCustomStepError) return reply.code(409).send({ error: err.message });
      if (err instanceof Error && /^(icon|defaultTools|slots)/.test(err.message)) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST /api/workspaces/:wsId/custom-steps/import
  app.post("/api/workspaces/:wsId/custom-steps/import", write, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;

    let createInput: ReturnType<typeof fromExportV1>;
    try {
      createInput = fromExportV1(req.body);
    } catch (err) {
      if (err instanceof CustomStepImportError) {
        return reply.code(400).send({ error: "invalid_export", message: err.message });
      }
      throw err;
    }

    try {
      const rec = await insertCustomAiStep(pool, {
        workspaceId: wsId,
        createdBy: ctx.user.id,
        ...createInput,
      });
      reply.code(201);
      return rec;
    } catch (err) {
      if (err instanceof DuplicateCustomStepError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  // GET /api/workspaces/:wsId/custom-steps/:id
  app.get("/api/workspaces/:wsId/custom-steps/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getCustomAiStep(pool, id);
    if (!rec || rec.workspaceId !== wsId) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  // GET /api/workspaces/:wsId/custom-steps/:id/export
  app.get("/api/workspaces/:wsId/custom-steps/:id/export", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const rec = await getCustomAiStep(pool, id);
    if (!rec || rec.workspaceId !== wsId) return reply.code(404).send({ error: "Not found" });
    const payload = toExportV1(rec);
    const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "custom-step";
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${slug}.json"`);
    return payload;
  });

  // POST /api/workspaces/:wsId/custom-steps/:id/enable
  app.post("/api/workspaces/:wsId/custom-steps/:id/enable", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const step = await getCustomAiStep(pool, id);
    if (!step || step.workspaceId !== wsId) return reply.code(404).send({ error: "not_found" });
    const errors = checkCustomStepReadiness(step);
    if (errors.length) {
      return reply.code(422).send({ error: "not_ready", errors });
    }
    const updated = await enableCustomAiStep(pool, id);
    return updated;
  });

  // POST /api/workspaces/:wsId/custom-steps/:id/disable
  app.post("/api/workspaces/:wsId/custom-steps/:id/disable", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const step = await getCustomAiStep(pool, id);
    if (!step || step.workspaceId !== wsId) return reply.code(404).send({ error: "not_found" });
    const updated = await disableCustomAiStep(pool, id);
    return updated;
  });

  // PATCH /api/workspaces/:wsId/custom-steps/:id
  app.patch("/api/workspaces/:wsId/custom-steps/:id", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const existing = await getCustomAiStep(pool, id);
    if (!existing || existing.workspaceId !== wsId) return reply.code(404).send({ error: "Not found" });
    if (existing.enabled) return reply.code(409).send({ error: "step_enabled_readonly" });
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
      return await updateCustomAiStep(pool, id, patch);
    } catch (err) {
      if (err instanceof DuplicateCustomStepError) return reply.code(409).send({ error: err.message });
      if (err instanceof Error && /^(icon|defaultTools|slots)/.test(err.message)) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // DELETE /api/workspaces/:wsId/custom-steps/:id
  app.delete("/api/workspaces/:wsId/custom-steps/:id", del, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const existing = await getCustomAiStep(pool, id);
    if (!existing || existing.workspaceId !== wsId) return reply.code(404).send({ error: "Not found" });
    await deleteCustomAiStep(pool, id);
    reply.code(204);
    return null;
  });
}
