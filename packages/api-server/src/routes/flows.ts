import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import { promoteFlowBody } from "../schemas/promote-flow.ts";
import type { FlowGraph, FlowScope } from "@journeyman/core";
import { ConductorJsonConverter } from "@journeyman/orchestrator";
import { phaseCatalog } from "@journeyman/phases/catalog";
import { validateFlowInputs, type ValidationCatalog, validateForPublish } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { getCustomAiPhase } from "@journeyman/custom-phases";
import { listVisibleSecrets } from "@journeyman/secrets";
import { listEnabledCodingModelsByProvider } from "@journeyman/coding-models";
import type { FlowSaveWarning, SecretBinding, SecretScope } from "@journeyman/core";
import { assertFlowReady } from "../services/assert-flow-ready.ts";

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
    // Resolver lookup order at runtime: user scope → org scope → process-level globals
    // (see packages/secrets/src/resolver.ts). These names aren't visible to the caller now,
    // but a run can still succeed if any of those scopes provides them. If none does,
    // the run fails with MissingSecretsError.
    warnings.push({
      code: "inaccessible_secrets",
      message:
        "Flow references secrets you can't see. At runtime they're resolved from your user scope, then the org scope, then global env. If none provides them, the run fails with MissingSecretsError.",
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

  // Model catalog validation: warn on references to unknown / deprecated models.
  const codingProvider = definition.defaults?.executorConfig?.["coding-cli"]?.provider;
  if (codingProvider) {
    const refs: Array<{ location: "flow-default" | "node"; nodeId?: string; modelId: string }> = [];
    if (definition.defaults?.defaultModel) {
      refs.push({ location: "flow-default", modelId: definition.defaults.defaultModel });
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
          message: "Flow references models that aren't enabled in the catalog for this coding provider.",
          entries: unknownEntries,
        });
      }
      if (deprecatedEntries.length > 0) {
        warnings.push({
          code: "deprecated_models",
          message: "Flow references deprecated models. They still run but should be replaced.",
          entries: deprecatedEntries,
        });
      }
    }
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

/** Pure function — does not mutate any reply. Returns the full report.
 *  `customPhaseInputs` maps a customPhaseId to its declared input fields,
 *  so custom-ai nodes get per-instance validation (required-field checks). */
export function computeValidationReport(
  definition: FlowGraph,
  customPhaseInputs: Map<string, Record<string, unknown>> = new Map(),
): FlowValidationReport {
  const errors: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  try {
    ConductorJsonConverter.validateGraph(definition);
  } catch (e: unknown) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const inputsByPhase = new Map(phaseCatalog.map((p) => [p.phaseType, p.inputFields ?? {}]));

  function declaredInputsFor(node: FlowGraph["nodes"][number]): Record<string, unknown> {
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
  const adaptedDef: FlowGraph = {
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
  const inputWarnings = validateFlowInputs(adaptedDef, validationCatalog);
  for (const w of inputWarnings) {
    if (w.code === "missing-required") continue; // already in `missing[]` via Check 1
    warnings.push(w.message);
  }

  return { ok: errors.length === 0 && missing.length === 0, errors, missing, warnings, secretWarnings: [] };
}

/** Pre-fetches custom-ai phase inputFields referenced by the flow so the
 *  validator can apply per-instance required-field checks. */
async function loadCustomPhaseInputs(
  c: Composition,
  definition: FlowGraph,
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
    case "workspaceId": return "string";
    case "repoRef": return "ref";
    case "issueRef": return "ref";
    default: return "string";
  }
}

/** Save-path adapter: writes 400 to reply if invalid. */
function validateAndWarnDefinition(
  definition: FlowGraph,
  reply: import("fastify").FastifyReply,
  customPhaseInputs?: Map<string, Record<string, unknown>>,
): { ok: true } | { ok: false } {
  const report = computeValidationReport(definition, customPhaseInputs);
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

function hasFlowTrigger(flow: FlowGraph): boolean {
  // A flow has a trigger if any node opts in. Until the trigger model is
  // formalised at the flow level (webhooks list, cron strings, etc.), accept
  // any flow with a start node — every flow has one, so this stays permissive
  // and matches existing behaviour for manual triggers via /runs.
  return flow.nodes.some(n => n.type === "start");
}

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
    const customPhaseInputs = await loadCustomPhaseInputs(c, body.definition);
    const report = computeValidationReport(body.definition, customPhaseInputs);
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

    const _customPhaseInputsCreate = await loadCustomPhaseInputs(c, body.definition as FlowGraph);
    const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply, _customPhaseInputsCreate);
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
    if (flow.status === "ready") { reply.code(409); return { error: "flow_is_ready" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.flows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    let warnings: FlowSaveWarning[] = [];
    if (body.definition) {
      const _customPhaseInputsUpd = await loadCustomPhaseInputs(c, body.definition as FlowGraph);
      const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply, _customPhaseInputsUpd);
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

  app.post("/flows/:id/publish", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }

    const version = await c.flowVersions.getById(flow.currentVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    const result = validateForPublish(version.definition, {
      hasTrigger: hasFlowTrigger(version.definition),
      visibleSecretNames,
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors }; }

    const updated = await c.flows.setStatus(id, "ready");
    if (!updated) { reply.code(500); return { error: "update_failed" }; }
    return { flow: updated };
  });

  app.post("/flows/:id/unpublish", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { confirm?: boolean };

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

    // In-flight run count and active-trigger counts: hooks for future wiring.
    // Until IRunStore exposes a count helper, treat as zero so the warning
    // never fires. The pre-flip warning becomes meaningful once those
    // subsystems land.
    const inFlightRunCount = 0;
    const activeTriggers = { webhooks: 0, schedules: 0 };

    if (!body.confirm && (inFlightRunCount > 0 || activeTriggers.webhooks > 0 || activeTriggers.schedules > 0)) {
      reply.code(409);
      return { warning: { inFlightRunCount, activeTriggers } };
    }

    const updated = await c.flows.setStatus(id, "draft");
    if (!updated) { reply.code(500); return { error: "update_failed" }; }
    return { flow: updated };
  });

  app.post("/flows/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = createRunBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canRead(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
    if (!assertFlowReady(flow, reply)) return;
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
