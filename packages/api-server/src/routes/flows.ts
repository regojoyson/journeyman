import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import { promoteFlowBody } from "../schemas/promote-flow.ts";
import type { WorkflowGraph, WorkflowScope, WorkflowInputValue } from "@journeyman/core";
import { ConductorJsonConverter } from "@journeyman/orchestrator";
import { phaseCatalog, buildPhaseConfigValidators } from "@journeyman/phases/catalog";
import { validateWorkflowInputs, type ValidationCatalog, validateForPublish } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { getCustomAiPhase } from "@journeyman/custom-phases";
import { customPhaseToShape, type CustomPhaseShape } from "@journeyman/custom-phases/shape-adapter";
import { listVisibleSecrets } from "@journeyman/secrets";
import { listEnabledCodingModelsByProvider } from "@journeyman/coding-models";
import type { WorkflowSaveWarning, SecretBinding, SecretScope, SecretSlotDef } from "@journeyman/core";
import { assertWorkflowReady } from "../services/assert-flow-ready.ts";

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
  workflowScope: WorkflowScope,
  definition: WorkflowGraph,
): Promise<WorkflowSaveWarning[]> {
  if (!c.pool) return [];
  const visible = await listVisibleSecrets(c.pool, ctx);
  const visibleByScopeName = new Set(visible.map(v => `${v.scope}:${v.name}`));
  const visibleNames = new Set(visible.map(v => v.name));

  const inaccessible = new Set<string>();
  const crossScope: Array<{ nodeId: string; slot: string; pinnedScope: SecretScope; workflowScope: WorkflowScope }> = [];
  const orphans: Array<{ nodeId: string; slot: string }> = [];

  // Pre-load slot definitions for any custom-ai phases referenced by the workflow.
  const customSlotsById = new Map<string, SecretSlotDef[]>();
  const customIds = new Set<string>();
  for (const node of definition.nodes) {
    if (node.phaseType === "custom-ai") {
      const id = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      if (typeof id === "string" && id) customIds.add(id);
    }
  }
  for (const id of customIds) {
    const phase = await getCustomAiPhase(c.pool, id);
    if (phase) customSlotsById.set(id, phase.slots ?? []);
  }

  for (const node of definition.nodes) {
    const bindings = (node.secretBindings ?? {}) as Record<string, SecretBinding>;

    // Build the declared-slot name set for orphan detection on custom-ai nodes.
    let declaredSlotNames: Set<string> | null = null;
    if (node.phaseType === "custom-ai") {
      const id = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const slots = typeof id === "string" ? customSlotsById.get(id) ?? [] : [];
      declaredSlotNames = new Set(slots.map(s => s.name));
      // Required-slot accessibility check for declared slots with NO binding entry yet.
      for (const slot of slots) {
        if (slot.optional) continue;
        if (bindings[slot.name] === undefined && !visibleNames.has(slot.name)) {
          inaccessible.add(slot.name);
        }
      }
    }

    for (const [slotName, binding] of Object.entries(bindings)) {
      // Orphan binding (custom-ai only): slot exists in node config but
      // is no longer declared on the phase definition.
      if (declaredSlotNames && !declaredSlotNames.has(slotName)) {
        orphans.push({ nodeId: node.id, slot: slotName });
        continue;
      }
      if (binding.mode === "auto") {
        if (!visibleNames.has(slotName)) inaccessible.add(slotName);
        continue;
      }
      // mode "pinned"
      if (!visibleByScopeName.has(`${binding.scope}:${binding.name}`)) {
        inaccessible.add(binding.name);
      }
      if (isNarrowerScope(binding.scope, workflowScope)) {
        crossScope.push({ nodeId: node.id, slot: slotName, pinnedScope: binding.scope, workflowScope });
      }
    }
  }

  const warnings: WorkflowSaveWarning[] = [];
  if (inaccessible.size > 0) {
    // Resolver lookup order at runtime: user scope → org scope → process-level globals
    // (see packages/secrets/src/resolver.ts). These names aren't visible to the caller now,
    // but a workflow instance can still succeed if any of those scopes provides them. If none does,
    // the workflow instance fails with MissingSecretsError.
    warnings.push({
      code: "inaccessible_secrets",
      message:
        "Workflow references secrets you can't see. At runtime they're resolved from your user scope, then the org scope, then global env. If none provides them, the workflow instance fails with MissingSecretsError.",
      names: [...inaccessible].sort(),
    });
  }
  if (crossScope.length > 0) {
    warnings.push({
      code: "cross_scope_pin",
      message: "Some slots are pinned to a narrower scope than the workflow itself. Other runners won't see them.",
      entries: crossScope,
    });
  }
  if (orphans.length > 0) {
    warnings.push({
      code: "orphan_secret_binding",
      message: `${orphans.length} secret binding(s) reference slots that are no longer declared on the custom phase.`,
      entries: orphans,
    });
  }

  // Model catalog validation: warn on references to unknown / deprecated models.
  const codingProvider = definition.defaults?.executorConfig?.["coding-cli"]?.provider;
  if (codingProvider) {
    const refs: Array<{ location: "workflow-default" | "node"; nodeId?: string; modelId: string }> = [];
    if (definition.defaults?.defaultModel) {
      refs.push({ location: "workflow-default", modelId: definition.defaults.defaultModel });
    }
    for (const node of definition.nodes) {
      if (node.type === "phase" && typeof node.model === "string" && node.model) {
        refs.push({ location: "node", nodeId: node.id, modelId: node.model });
      }
    }
    if (refs.length > 0) {
      const models = await listEnabledCodingModelsByProvider(c.pool, codingProvider);
      const enabled = new Map(models.map(m => [m.modelId, m]));
      const unknownEntries = refs
        .filter(r => !enabled.has(r.modelId))
        .map(r => ({ ...r, provider: codingProvider }));
      const deprecatedEntries = refs
        .filter(r => enabled.get(r.modelId)?.deprecated === true)
        .map(r => ({ ...r, provider: codingProvider }));
      if (unknownEntries.length > 0) {
        warnings.push({
          code: "unknown_models",
          message: "Workflow references models that aren't enabled in the catalog for this coding provider.",
          entries: unknownEntries,
        });
      }
      if (deprecatedEntries.length > 0) {
        warnings.push({
          code: "deprecated_models",
          message: "Workflow references deprecated models. They still run but should be replaced.",
          entries: deprecatedEntries,
        });
      }
    }
  }

  return warnings;
}

function isNarrowerScope(pinned: SecretScope, workflow: WorkflowScope): boolean {
  if (workflow === "user") return false;
  if (workflow === "org") return pinned === "user";
  /* global */ return pinned === "user" || pinned === "org";
}

export interface WorkflowValidationReport {
  ok: boolean;
  errors: string[];                              // hard failures (graph structure, ref reachability)
  missing: string[];                             // required inputs without a typed value or binding
  warnings: string[];                            // refs to undeclared fields — non-blocking
  secretWarnings: WorkflowSaveWarning[];         // inaccessible secret references — non-blocking
}

/** Pure function — does not mutate any reply. Returns the full report.
 *  `customPhaseInputs` maps a customPhaseId to its declared input fields,
 *  so custom-ai nodes get per-instance validation (required-field checks). */
export function computeValidationReport(
  definition: WorkflowGraph,
  customPhaseInputs: Map<string, Record<string, unknown>> = new Map(),
): WorkflowValidationReport {
  const errors: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  try {
    ConductorJsonConverter.validateGraph(definition);
  } catch (e: unknown) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const inputsByPhase = new Map(phaseCatalog.map((p) => [p.phaseType, p.inputFields ?? {}]));

  function declaredInputsFor(node: WorkflowGraph["nodes"][number]): Record<string, unknown> {
    if (node.phaseType === "custom-ai") {
      const cfg = (node.config ?? {}) as { customPhaseId?: string };
      const id = cfg.customPhaseId;
      if (id && customPhaseInputs.has(id)) return customPhaseInputs.get(id)!;
    }
    return inputsByPhase.get(node.phaseType ?? "") ?? {};
  }

  // Check 1: required input fields are satisfied (typed value or binding) on every phase node.
  for (const node of definition.nodes) {
    if (node.type !== "phase" || !node.phaseType) continue;
    const declared = declaredInputsFor(node);
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

  // Check 2: shape-aware ref + binding validation (delegates to @journeyman/core).
  // Walks every phase node, validates each input against its catalog declaration:
  // shape-mismatch, dangling-ref-node, dangling-ref-path, missing-input-shape.
  // missing-required is already handled by Check 1 above (which produces a
  // hard-blocking `missing[]` signal — keep that contract intact).
  const validationCatalog: ValidationCatalog = {};
  for (const entry of phaseCatalog) {
    validationCatalog[entry.phaseType] = {
      inputFields: entry.inputFields,
      outputSchema: entry.outputSchema,
    };
  }
  // Per-node overlay: custom-ai nodes get per-instance inputFields keyed by
  // the synthetic phaseType `custom-ai:<id>` so validateFlowInputs picks up
  // the right declarations. We mutate the validationCatalog AND temporarily
  // rewrite the node's phaseType for the validator's lookup.
  for (const [id, fields] of customPhaseInputs) {
    validationCatalog[`custom-ai:${id}`] = {
      inputFields: fields as ValidationCatalog[string]["inputFields"],
      outputSchema: validationCatalog["custom-ai"]?.outputSchema ?? null,
    };
  }
  const adaptedDef: WorkflowGraph = {
    ...definition,
    nodes: definition.nodes.map((n) => {
      if (n.phaseType === "custom-ai") {
        const cfg = (n.config ?? {}) as { customPhaseId?: string };
        if (cfg.customPhaseId && customPhaseInputs.has(cfg.customPhaseId)) {
          return { ...n, phaseType: `custom-ai:${cfg.customPhaseId}` };
        }
      }
      return n;
    }),
  };
  const inputWarnings = validateWorkflowInputs(adaptedDef, validationCatalog);
  for (const w of inputWarnings) {
    if (w.code === "missing-required") continue; // already in `missing[]` via Check 1
    warnings.push(w.message);
  }

  return { ok: errors.length === 0 && missing.length === 0, errors, missing, warnings, secretWarnings: [] };
}

/** Pre-fetches custom-ai phase inputFields referenced by the workflow so the
 *  validator can apply per-instance required-field checks. */
async function loadCustomPhaseInputs(
  c: Composition,
  definition: WorkflowGraph,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!c.pool) return map;
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (node.phaseType !== "custom-ai") continue;
    const cfg = (node.config ?? {}) as { customPhaseId?: string };
    if (cfg.customPhaseId) ids.add(cfg.customPhaseId);
  }
  for (const id of ids) {
    const phase = await getCustomAiPhase(c.pool, id);
    if (!phase) continue;
    // Convert CustomPhaseInputField[] → InputFields shape (record keyed by name).
    const fields: Record<string, { shape: { type: string }; required: boolean; label?: string }> = {};
    for (const f of phase.inputFields ?? []) {
      fields[f.name] = {
        shape: { type: customTypeToShape(f.type) },
        required: f.required,
        label: f.name,
      };
    }
    map.set(id, fields as unknown as Record<string, unknown>);
  }
  return map;
}

function customTypeToShape(t: string): string {
  switch (t) {
    case "string": case "number": case "boolean": return t;
    case "string[]": return "array";
    case "object": return "object";
    case "array": return "array";
    case "workspaceDir": return "string";
    case "repoRef": return "ref";
    case "issueRef": return "ref";
    default: return "string";
  }
}

/** Save-path adapter: writes 400 to reply if invalid. */
function validateAndWarnDefinition(
  definition: WorkflowGraph,
  reply: import("fastify").FastifyReply,
  customPhaseInputs?: Map<string, Record<string, unknown>>,
): { ok: true } | { ok: false } {
  const report = computeValidationReport(definition, customPhaseInputs);
  if (report.errors.length) {
    reply.code(400).send({ error: "WorkflowValidationError", message: report.errors[0], errors: report.errors });
    return { ok: false };
  }
  if (report.missing.length) {
    reply.code(400).send({ error: "WorkflowValidationError", message: "Required inputs missing", missing: report.missing });
    return { ok: false };
  }
  if (report.warnings.length) console.warn("[workflow save warnings]", report.warnings);
  return { ok: true };
}

async function loadCustomPhaseShapes(
  c: Composition,
  graph: WorkflowGraph,
): Promise<Map<string, CustomPhaseShape>> {
  const map = new Map<string, CustomPhaseShape>();
  if (!c.pool) return map;
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type === "phase" && n.phaseType === "custom-ai") {
      const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  for (const id of ids) {
    const phase = await getCustomAiPhase(c.pool, id);
    if (phase) map.set(id, customPhaseToShape(phase));
  }
  return map;
}

/** Save-path structural check: rejects only graphs that cannot round-trip
 *  through ConductorJsonConverter. Content-level validation (missing inputs,
 *  dangling refs, shape mismatches) is intentionally skipped on save and
 *  enforced only on publish via validateForPublish. */
async function validateGraphStructure(
  c: Composition,
  definition: WorkflowGraph,
  reply: import("fastify").FastifyReply,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const customPhaseDefs = await loadCustomPhaseShapes(c, definition);
    ConductorJsonConverter.validateGraph(definition, undefined, customPhaseDefs);
    return { ok: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    reply.code(400).send({
      error: "WorkflowValidationError",
      message,
      errors: [message],
    });
    return { ok: false };
  }
}
import {
  canCreateAtScope, canDelete, canEdit, canPromoteTo, canRead,
  type Caller,
} from "../services/flow-access.ts";

function hasWorkflowTrigger(workflow: WorkflowGraph): boolean {
  return workflow.nodes.some(n => n.type === "start");
}

function callerFromCtx(ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>): Caller {
  return {
    userId: ctx.user.id,
    orgId: ctx.org.id,
    role: ctx.role,
    isPlatformAdmin: ctx.isPlatformAdmin,
  };
}

export function registerWorkflowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  // Non-destructive validation — caller passes a definition, we return the full report.
  app.post("/workflows/validate", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const body = req.body as { definition?: WorkflowGraph };
    if (!body?.definition || typeof body.definition !== "object") {
      reply.code(400);
      return { error: "bad_request", message: "definition is required" };
    }
    const customPhaseInputs = await loadCustomPhaseInputs(c, body.definition);
    const report = computeValidationReport(body.definition, customPhaseInputs);
    const callerScope: WorkflowScope = "user";
    const secretWarnings = await computeSaveWarnings(c, ctx, callerScope, body.definition);

    // Run the same node-level checks publish runs, so the Validate button
    // surfaces unresolved-binding / missing-config / orphan / gate errors
    // without the user having to attempt a publish to see them.
    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map((v) => v.name));
    const customAiPhaseDefaults = new Map<string, { defaultTools?: readonly import("@journeyman/core").CanonicalTool[] }>();
    if (c.pool) {
      const customPhaseIds = new Set<string>();
      for (const node of body.definition.nodes) {
        if (node.type === "phase" && node.phaseType === "custom-ai") {
          const id = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
          if (typeof id === "string" && id) customPhaseIds.add(id);
        }
      }
      for (const id of customPhaseIds) {
        const phase = await getCustomAiPhase(c.pool, id);
        if (phase) customAiPhaseDefaults.set(id, { defaultTools: phase.defaultTools });
      }
    }
    const publishResult = validateForPublish(body.definition, {
      hasTrigger: hasWorkflowTrigger(body.definition),
      visibleSecretNames,
      phaseConfigValidators: buildPhaseConfigValidators(phaseCatalog),
      customAiPhaseDefaults,
    });
    const seenErrors = new Set(report.errors);
    const seenMissing = new Set(report.missing);
    const seenWarnings = new Set(report.warnings);
    for (const e of publishResult.errors) {
      const label = e.nodeLabel ?? (e.nodeId ? "Unknown step" : "Flow");
      const msg = `[${label}] ${e.message}`;
      if (e.severity === "warning") {
        if (!seenWarnings.has(msg)) { report.warnings.push(msg); seenWarnings.add(msg); }
      } else if (e.code === "missing_config" || e.code === "unresolved_binding") {
        if (!seenMissing.has(msg)) { report.missing.push(msg); seenMissing.add(msg); }
      } else {
        if (!seenErrors.has(msg)) { report.errors.push(msg); seenErrors.add(msg); }
      }
    }
    const customPhaseDefs = await loadCustomPhaseShapes(c, body.definition);
    const catalogMap = new Map(phaseCatalog.map(p => [
      p.phaseType,
      { phaseType: p.phaseType, inputFields: p.inputFields, outputSchema: p.outputSchema },
    ]));
    try {
      ConductorJsonConverter.validateGraph(body.definition, catalogMap, customPhaseDefs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!seenErrors.has(msg)) {
        report.errors.push(msg);
        seenErrors.add(msg);
      }
    }
    report.ok = report.errors.length === 0 && report.missing.length === 0;

    return { ...report, secretWarnings };
  });

  app.post("/workflows", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const caller = callerFromCtx(ctx);
    const body = createFlowBody.parse(req.body);

    if (!canCreateAtScope(body.scope as WorkflowScope, caller)) {
      reply.code(403); return { error: "forbidden" };
    }

    const orgId =
      body.scope === "user"   ? caller.orgId :
      body.scope === "org"    ? (body.orgId ?? caller.orgId) :
      /* global */              null;

    if (body.scope === "org" && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_create_workflow_in_other_org" };
    }

    const ownerUserId = body.scope === "user" ? caller.userId : null;

    const _v = await validateGraphStructure(c, body.definition as WorkflowGraph, reply);
    if (!_v.ok) return;

    const warnings = await computeSaveWarnings(c, ctx, body.scope as WorkflowScope, body.definition as WorkflowGraph);

    const { workflow, version } = await c.workflows.create({
      scope: body.scope as WorkflowScope,
      name: body.name,
      description: body.description,
      orgId,
      ownerUserId,
      initialDefinition: body.definition as WorkflowGraph,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return warnings.length ? { workflow, version, warnings } : { workflow, version };
  });

  app.get("/workflows", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const q = req.query as { scope?: string; orgId?: string; limit?: string; page?: string; page_size?: string };
    const baseFilter = {
      callerUserId: ctx.user.id,
      callerOrgId: ctx.org.id,
      callerIsPlatformAdmin: ctx.isPlatformAdmin,
      callerIsOrgAdmin: ctx.role === "admin",
      scope: q.scope as WorkflowScope | undefined,
      orgId: q.orgId,
    };

    const paginated = q.page !== undefined || q.page_size !== undefined;
    if (paginated) {
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const requestedSize = Number(q.page_size ?? 25) || 25;
      const pageSize = Math.min(100, Math.max(1, requestedSize));
      const offset = (page - 1) * pageSize;
      const [workflows, total] = await Promise.all([
        c.workflows.list({ ...baseFilter, limit: pageSize, offset }),
        c.workflows.count(baseFilter),
      ]);
      return { workflows, total, page, pageSize };
    }

    const workflows = await c.workflows.list({
      ...baseFilter,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { workflows };
  });

  app.get("/workflows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    return { workflow };
  });

  app.put("/workflows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);

    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (workflow.status === "ready") { reply.code(409); return { error: "workflow_is_ready" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.workflows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    let warnings: WorkflowSaveWarning[] = [];
    if (body.definition) {
      const _v = await validateGraphStructure(c, body.definition as WorkflowGraph, reply);
      if (!_v.ok) return;
      warnings = await computeSaveWarnings(c, ctx, workflow.scope, body.definition as WorkflowGraph);
      newVersion = await c.workflowVersions.appendVersion({
        workflowId: id, definition: body.definition as WorkflowGraph, createdByUserId: caller.userId,
      });
    }
    const updated = await c.workflows.getById(id);
    return warnings.length ? { workflow: updated, version: newVersion, warnings } : { workflow: updated, version: newVersion };
  });

  app.delete("/workflows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canDelete(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    await c.workflows.delete(id);
    reply.code(204).send();
  });

  app.get("/workflows/:id/versions/current", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!workflow.currentVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });

  app.get("/workflow_versions/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = await c.workflowVersions.getById(id);
    if (!version) { reply.code(404); return { error: "not_found" }; }
    return { version };
  });

  app.post("/workflows/:id/publish", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };

    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!workflow.currentVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }

    const version = await c.workflowVersions.getById(workflow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    const customAiPhaseDefaults = new Map<string, { defaultTools?: readonly import("@journeyman/core").CanonicalTool[] }>();
    if (c.pool) {
      const customPhaseIds = new Set<string>();
      for (const node of version.definition.nodes) {
        if (node.type === "phase" && node.phaseType === "custom-ai") {
          const id = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
          if (typeof id === "string" && id) customPhaseIds.add(id);
        }
      }
      for (const id of customPhaseIds) {
        const phase = await getCustomAiPhase(c.pool, id);
        if (phase) customAiPhaseDefaults.set(id, { defaultTools: phase.defaultTools });
      }
    }

    try {
      const customPhaseDefs = await loadCustomPhaseShapes(c, version.definition);
      const catalogMap = new Map(phaseCatalog.map(p => [
        p.phaseType,
        { phaseType: p.phaseType, inputFields: p.inputFields, outputSchema: p.outputSchema },
      ]));
      ConductorJsonConverter.validateGraph(version.definition, catalogMap, customPhaseDefs);
    } catch (e) {
      reply.code(400);
      return { errors: [{ code: "shape_mismatch", message: e instanceof Error ? e.message : String(e) }] };
    }

    const result = validateForPublish(version.definition, {
      hasTrigger: hasWorkflowTrigger(version.definition),
      visibleSecretNames,
      phaseConfigValidators: buildPhaseConfigValidators(phaseCatalog),
      customAiPhaseDefaults,
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors.filter(e => !e.severity || e.severity === "error") }; }

    const updated = await c.workflows.setStatus(id, "ready");
    if (!updated) { reply.code(500); return { error: "update_failed" }; }
    const warnings = result.errors.filter(e => e.severity === "warning");
    return { workflow: updated, warnings };
  });

  app.post("/workflows/:id/unpublish", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { confirm?: boolean };

    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }

    const inFlightCount = 0;
    const activeTriggers = { webhooks: 0, schedules: 0 };

    if (!body.confirm && (inFlightCount > 0 || activeTriggers.webhooks > 0 || activeTriggers.schedules > 0)) {
      reply.code(409);
      return { warning: { inFlightCount, activeTriggers } };
    }

    const updated = await c.workflows.setStatus(id, "draft");
    if (!updated) { reply.code(500); return { error: "update_failed" }; }
    return { workflow: updated };
  });

  app.post("/workflows/:id/workflow-instances", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);

    const workflow = await c.workflows.getById(id);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(workflow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!assertWorkflowReady(workflow, reply)) return;
    if (!workflow.currentVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const { workflowInstanceId, engineWorkflowId } = await c.orchestrator.submit({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowNameSnapshot: workflow.name,
      workflowScopeSnapshot: workflow.scope,
      definitionSnapshot: version.definition,
      inputs: body.inputs,
      startedByUserId: caller.userId,
      startedByOrgId: ctx.org.id,
    });

    reply.code(202);
    return { workflowInstanceId, engineWorkflowId };
  });

  // ----- Snapshot actions -----

  app.post("/workflows/:id/clone", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await c.workflows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const ver = await c.workflowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const { workflow } = await c.workflows.create({
      scope: "user",
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      orgId: caller.orgId,
      ownerUserId: caller.userId,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: workflow.id };
  });

  app.post("/workflows/:id/promote", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = promoteFlowBody.parse(req.body);
    const src = await c.workflows.getById(id);
    if (!src) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(src, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!canPromoteTo(body.targetScope, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!src.currentVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const ver = await c.workflowVersions.getById(src.currentVersionId);
    if (!ver) { reply.code(500); return { error: "version_missing" }; }

    const orgId =
      body.targetScope === "org"
        ? (body.orgId ?? src.orgId ?? caller.orgId)
        : null;

    if (body.targetScope === "org" && !caller.isPlatformAdmin && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_promote_to_other_org" };
    }

    const { workflow } = await c.workflows.create({
      scope: body.targetScope,
      name: body.name ?? src.name,
      description: src.description ?? undefined,
      orgId,
      ownerUserId: null,
      initialDefinition: ver.definition,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return { id: workflow.id };
  });
}
