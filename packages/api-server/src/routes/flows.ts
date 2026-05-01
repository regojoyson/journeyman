import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import { promoteFlowBody } from "../schemas/promote-flow.ts";
import type { FlowGraph, FlowScope } from "@journeyman/core";
import { ConductorJsonConverter, parseRef } from "@journeyman/orchestrator";
import { phaseCatalog } from "@journeyman/phases/catalog";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleSecrets } from "@journeyman/secrets";
import type { FlowSaveWarning, SecretBinding, SecretScope } from "@journeyman/core";

/**
 * Compute non-blocking warnings about secret references in a flow definition.
 * Save proceeds regardless; warnings are attached to the response.
 *
 * Two warning shapes:
 *   - inaccessible_secrets: caller can't reach the referenced secret
 *   - cross_scope_pin: a slot is pinned to a narrower scope than the flow itself
 */
async function computeSaveWarnings(
  c: Composition,
  ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>,
  flowScope: FlowScope,
  definition: FlowGraph,
): Promise<FlowSaveWarning[]> {
  if (!c.pool) return [];
  const visible = await listVisibleSecrets(c.pool, ctx);
  const visibleByScopeName = new Set(visible.map(v => `${v.scope}:${v.name}`));
  const visibleNames = new Set(visible.map(v => v.name));

  const inaccessible = new Set<string>();
  const crossScope: Array<{ nodeId: string; slot: string; pinnedScope: SecretScope; flowScope: FlowScope }> = [];

  for (const node of definition.nodes) {
    const bindings = (node.secretBindings ?? {}) as Record<string, SecretBinding>;
    for (const [slotName, binding] of Object.entries(bindings)) {
      if (binding.mode === "auto") {
        if (!visibleNames.has(slotName)) inaccessible.add(slotName);
        continue;
      }
      // mode "pinned"
      if (!visibleByScopeName.has(`${binding.scope}:${binding.name}`)) {
        inaccessible.add(binding.name);
      }
      if (isNarrowerScope(binding.scope, flowScope)) {
        crossScope.push({ nodeId: node.id, slot: slotName, pinnedScope: binding.scope, flowScope });
      }
    }
  }

  const warnings: FlowSaveWarning[] = [];
  if (inaccessible.size > 0) {
    warnings.push({
      code: "inaccessible_secrets",
      message: "Flow references secrets you cannot currently access. Runs will fail until they are created.",
      names: [...inaccessible].sort(),
    });
  }
  if (crossScope.length > 0) {
    warnings.push({
      code: "cross_scope_pin",
      message: "Some slots are pinned to a narrower scope than the flow itself. Other runners won't see them.",
      entries: crossScope,
    });
  }
  return warnings;
}

function isNarrowerScope(pinned: SecretScope, flow: FlowScope): boolean {
  if (flow === "user") return false;
  if (flow === "org") return pinned === "user";
  /* global */ return pinned === "user" || pinned === "org";
}

export interface FlowValidationReport {
  ok: boolean;
  errors: string[];                         // hard failures (graph structure, ref reachability)
  missing: string[];                        // required inputs without a typed value or binding
  warnings: string[];                       // refs to undeclared fields — non-blocking
  secretWarnings: FlowSaveWarning[];        // inaccessible secret references — non-blocking
}

/** Pure function — does not mutate any reply. Returns the full report. */
export function computeValidationReport(definition: FlowGraph): FlowValidationReport {
  const errors: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  try {
    ConductorJsonConverter.validateGraph(definition);
  } catch (e: unknown) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const outputsByPhase = new Map(phaseCatalog.map((p) => [p.phaseType, p.outputSchema ?? {}]));
  const inputsByPhase = new Map(phaseCatalog.map((p) => [p.phaseType, p.inputFields ?? {}]));

  // Check 1: required input fields are satisfied (typed value or binding) on every phase node.
  for (const node of definition.nodes) {
    if (node.type !== "phase" || !node.phaseType) continue;
    const declared = inputsByPhase.get(node.phaseType) ?? {};
    const config = (node.config ?? {}) as Record<string, unknown>;
    const inputs = (node.inputs ?? {}) as Record<string, { kind?: string }>;
    for (const [fieldName, meta] of Object.entries(declared)) {
      const m = meta as { required?: boolean };
      if (!m.required) continue;
      const hasBinding = inputs[fieldName]?.kind === "ref";
      const cv = config[fieldName];
      const hasTyped = cv !== undefined && cv !== null && cv !== "";
      if (!hasBinding && !hasTyped) {
        missing.push(`'${node.displayName ?? node.id}' (${node.phaseType}) is missing required input '${fieldName}'`);
      }
    }
  }

  // Check 2: ref points at declared field on upstream phase (warning only).
  for (const node of definition.nodes) {
    for (const [field, v] of Object.entries(node.inputs ?? {})) {
      if (v.kind !== "ref") continue;
      const parsed = parseRef(v.ref);
      if (!parsed || parsed.scope === "workflow.input") continue;
      const upstream = definition.nodes.find((n) => n.id === parsed.source);
      if (!upstream?.phaseType) continue;
      const declared =
        parsed.scope === "input"
          ? (inputsByPhase.get(upstream.phaseType) ?? {})
          : (outputsByPhase.get(upstream.phaseType) ?? {});
      if (!(parsed.field in declared))
        warnings.push(
          `'${node.id}.${field}' uses undeclared ${parsed.scope} field '${parsed.field}' on '${upstream.phaseType}'`,
        );
    }
  }

  return { ok: errors.length === 0 && missing.length === 0, errors, missing, warnings, secretWarnings: [] };
}

/** Save-path adapter: writes 400 to reply if invalid. */
function validateAndWarnDefinition(
  definition: FlowGraph,
  reply: import("fastify").FastifyReply,
): { ok: true } | { ok: false } {
  const report = computeValidationReport(definition);
  if (report.errors.length) {
    reply.code(400).send({ error: "FlowValidationError", message: report.errors[0], errors: report.errors });
    return { ok: false };
  }
  if (report.missing.length) {
    reply.code(400).send({ error: "FlowValidationError", message: "Required inputs missing", missing: report.missing });
    return { ok: false };
  }
  if (report.warnings.length) console.warn("[flow save warnings]", report.warnings);
  return { ok: true };
}
import {
  canCreateAtScope, canDelete, canEdit, canPromoteTo, canRead,
  type Caller,
} from "../services/flow-access.ts";

function callerFromCtx(ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>): Caller {
  return {
    userId: ctx.user.id,
    orgId: ctx.org.id,
    role: ctx.role,
    isPlatformAdmin: ctx.isPlatformAdmin,
  };
}

export function registerFlowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  // Non-destructive validation — caller passes a definition, we return the full report.
  app.post("/flows/validate", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const body = req.body as { definition?: FlowGraph };
    if (!body?.definition || typeof body.definition !== "object") {
      reply.code(400);
      return { error: "bad_request", message: "definition is required" };
    }
    const report = computeValidationReport(body.definition);
    // Validate works against the user's caller scope — fall back to "user" since
    // no flow record exists yet at validate time.
    const callerScope: FlowScope = "user";
    const secretWarnings = await computeSaveWarnings(c, ctx, callerScope, body.definition);
    return { ...report, secretWarnings };
  });

  app.post("/flows", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const caller = callerFromCtx(ctx);
    const body = createFlowBody.parse(req.body);

    if (!canCreateAtScope(body.scope as FlowScope, caller)) {
      reply.code(403); return { error: "forbidden" };
    }

    const orgId =
      body.scope === "user"   ? caller.orgId :
      body.scope === "org"    ? (body.orgId ?? caller.orgId) :
      /* global */              null;

    if (body.scope === "org" && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_create_flow_in_other_org" };
    }

    const ownerUserId = body.scope === "user" ? caller.userId : null;

    const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply);
    if (!_v.ok) return;

    const warnings = await computeSaveWarnings(c, ctx, body.scope as FlowScope, body.definition as FlowGraph);

    const { flow, version } = await c.flows.create({
      scope: body.scope as FlowScope,
      name: body.name,
      description: body.description,
      orgId,
      ownerUserId,
      initialDefinition: body.definition as FlowGraph,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return warnings.length ? { flow, version, warnings } : { flow, version };
  });

  app.get("/flows", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const q = req.query as { scope?: string; orgId?: string; limit?: string };
    const flows = await c.flows.list({
      callerUserId: ctx.user.id,
      callerOrgId: ctx.org.id,
      callerIsPlatformAdmin: ctx.isPlatformAdmin,
      callerIsOrgAdmin: ctx.role === "admin",
      scope: q.scope as FlowScope | undefined,
      orgId: q.orgId,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { flows };
  });

  app.get("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    return { flow };
  });

  app.put("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.flows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    let warnings: FlowSaveWarning[] = [];
    if (body.definition) {
      const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply);
      if (!_v.ok) return;
      warnings = await computeSaveWarnings(c, ctx, flow.scope, body.definition as FlowGraph);
      newVersion = await c.flowVersions.appendVersion({
        flowId: id, definition: body.definition as FlowGraph, createdByUserId: caller.userId,
      });
    }
    const updated = await c.flows.getById(id);
    return warnings.length ? { flow: updated, version: newVersion, warnings } : { flow: updated, version: newVersion };
  });

  app.delete("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    await c.flows.delete(id);
    reply.code(204).send();
  });

  app.get("/flows/:id/versions/current", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });

  app.get("/flow_versions/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = await c.flowVersions.getById(id);
    if (!version) { reply.code(404); return { error: "not_found" }; }
    return { version };
  });

  app.post("/flows/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { runId, engineWorkflowId } = await c.orchestrator.submit({
      flowId: flow.id,
      flowVersionId: version.id,
      flowNameSnapshot: flow.name,
      flowScopeSnapshot: flow.scope,
      definitionSnapshot: version.definition,
      inputs: body.inputs,
      startedByUserId: caller.userId,
      startedByOrgId: ctx.org.id,
    });

    reply.code(202);
    return { runId, engineWorkflowId };
  });

  // ----- Snapshot actions -----

  app.post("/flows/:id/clone", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const { flow } = await c.flows.create({
      scope: "user",
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      orgId: caller.orgId,
      ownerUserId: caller.userId,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });

  app.post("/flows/:id/promote", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = promoteFlowBody.parse(req.body);
    const src = await c.flows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!canPromoteTo(body.targetScope, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }
    const ver = await c.flowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const orgId =
      body.targetScope === "org"
        ? (body.orgId ?? src.orgId ?? caller.orgId)
        : null;

    if (body.targetScope === "org" && !caller.isPlatformAdmin && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_promote_to_other_org" };
    }

    const { flow } = await c.flows.create({
      scope: body.targetScope,
      name: body.name ?? src.name,
      description: src.description ?? undefined,
      orgId,
      ownerUserId: null,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: flow.id };
  });
}
