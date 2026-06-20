import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { createFlowBody } from "../schemas/flow.ts";
import { createRunBody } from "../schemas/run.ts";
import { updateFlowBody } from "../schemas/update-flow.ts";
import { cloneFlowBody } from "../schemas/clone-flow.ts";
import type { WorkflowGraph, PublishError, ProposedCustomStep } from "@journeyman/core";
import { findManualTriggerNode } from "@journeyman/core";
import {
  refreshTriggerIndexOnPublish,
  refreshTriggerIndexOnUnpublish,
} from "../services/workflow-trigger-index.ts";
import { ConductorJsonConverter, WorkflowValidationError } from "@journeyman/orchestrator";
import { stepCatalog, buildStepConfigValidators } from "@journeyman/steps/catalog";
import { validateWorkflowInputs, type ValidationCatalog, validateForPublish } from "@journeyman/core";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getCustomAiStep } from "@journeyman/custom-steps";
import { shapesFromProposedSteps } from "./proposed-custom-steps.ts";
import { customStepToShape, type CustomStepShape } from "@journeyman/custom-steps/shape-adapter";
import { listVisibleSecrets } from "@journeyman/secrets";
import { listEnabledCodingModelsByProvider } from "@journeyman/coding-models";
import type { WorkflowSaveWarning, SecretBinding, SecretSlotDef } from "@journeyman/core";
import { PROVIDER_CATALOG, defaultProviderForKind } from "@journeyman/core";
import { assertWorkflowReady } from "../services/assert-flow-ready.ts";

/**
 * Compute non-blocking warnings about secret references in a flow definition.
 * Save proceeds regardless; warnings are attached to the response.
 */
async function computeSaveWarnings(
  c: Composition,
  ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>,
  definition: WorkflowGraph,
): Promise<WorkflowSaveWarning[]> {
  if (!c.pool) return [];
  const visible = await listVisibleSecrets(c.pool, ctx);
  const visibleByScopeName = new Set(visible.map(v => `${v.scope}:${v.name}`));
  const visibleNames = new Set(visible.map(v => v.name));

  const inaccessible = new Set<string>();
  const orphans: Array<{ nodeId: string; slot: string }> = [];

  // Pre-load slot definitions for any custom-ai steps referenced by the workflow.
  const customSlotsById = new Map<string, SecretSlotDef[]>();
  const customIds = new Set<string>();
  for (const node of definition.nodes) {
    if (node.stepType === "custom-ai") {
      const id = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
      if (typeof id === "string" && id) customIds.add(id);
    }
  }
  for (const id of customIds) {
    const step = await getCustomAiStep(c.pool, id);
    if (step) customSlotsById.set(id, step.slots ?? []);
  }

  for (const node of definition.nodes) {
    const bindings = (node.secretBindings ?? {}) as Record<string, SecretBinding>;

    let declaredSlotNames: Set<string> | null = null;
    if (node.stepType === "custom-ai") {
      const id = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
      const dbSlots = typeof id === "string" ? customSlotsById.get(id) ?? [] : [];
      const providerValue =
        node.executorConfig?.provider ??
        definition.defaults?.executorConfig?.["coding-cli"]?.provider ??
        defaultProviderForKind("coding-cli")?.value;
      const providerSlots = providerValue
        ? PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === providerValue)?.slots ?? []
        : [];
      declaredSlotNames = new Set([
        ...dbSlots.map(s => s.name),
        ...providerSlots.map(s => s.name),
      ]);
      for (const slot of [...dbSlots, ...providerSlots]) {
        if (slot.optional) continue;
        if (bindings[slot.name] === undefined && !visibleNames.has(slot.name)) {
          inaccessible.add(slot.name);
        }
      }
    }

    for (const [slotName, binding] of Object.entries(bindings)) {
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
    }
  }

  const warnings: WorkflowSaveWarning[] = [];
  if (inaccessible.size > 0) {
    warnings.push({
      code: "inaccessible_secrets",
      message:
        "Workflow references secrets you can't see. At runtime they're resolved from the workspace, then the org. If none provides them, the workflow instance fails with MissingSecretsError.",
      names: [...inaccessible].sort(),
    });
  }
  if (orphans.length > 0) {
    warnings.push({
      code: "orphan_secret_binding",
      message: `${orphans.length} secret binding(s) reference slots that are no longer declared on the custom step.`,
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
      if (node.type === "step" && typeof node.model === "string" && node.model) {
        refs.push({ location: "node", nodeId: node.id, modelId: node.model });
      }
    }
    if (refs.length > 0) {
      const models = await listEnabledCodingModelsByProvider(c.pool, ctx.org.id, codingProvider);
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

export interface WorkflowValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings: WorkflowSaveWarning[];
  diagnostics: PublishError[];
}

export function computeValidationReport(
  definition: WorkflowGraph,
  customStepShapes: Map<string, CustomStepShape> = new Map(),
): WorkflowValidationReport {
  const errors: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const diagnostics: PublishError[] = [];

  try {
    ConductorJsonConverter.validateGraph(definition);
  } catch (e: unknown) {
    if (e instanceof WorkflowValidationError && e.diagnostic) {
      diagnostics.push(e.diagnostic);
    } else {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const inputsByStep = new Map(stepCatalog.map((p) => [p.stepType, p.inputFields ?? {}]));

  function declaredInputsFor(node: WorkflowGraph["nodes"][number]): Record<string, unknown> {
    if (node.stepType === "custom-ai") {
      const cfg = (node.config ?? {}) as { customStepId?: string };
      const id = cfg.customStepId;
      if (id && customStepShapes.has(id)) {
        return customStepShapes.get(id)!.inputFields as Record<string, unknown>;
      }
    }
    return inputsByStep.get(node.stepType ?? "") ?? {};
  }

  for (const node of definition.nodes) {
    if (node.type !== "step" || !node.stepType) continue;
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
        missing.push(`'${node.displayName ?? node.id}' (${node.id}) is missing required input '${fieldName}'`);
      }
    }
  }

  for (const node of definition.nodes) {
    if (node.type !== "trigger-webhook") continue;
    const mapping = ((node.config ?? {}) as { inputsMapping?: Record<string, { fromPath?: string }> }).inputsMapping ?? {};
    for (const inp of definition.inputDefs ?? []) {
      if (!inp.required) continue;
      const fromPath = mapping[inp.name]?.fromPath;
      if (!fromPath || fromPath.trim() === "") {
        missing.push(`'${node.displayName ?? node.id}' (${node.id}) is missing payload mapping for required input '${inp.name}'`);
      }
    }
  }

  const validationCatalog: ValidationCatalog = {};
  for (const entry of stepCatalog) {
    validationCatalog[entry.stepType] = {
      inputFields: entry.inputFields,
      outputSchema: entry.outputSchema,
    };
  }
  if (customStepShapes.size > 0) {
    const existing = validationCatalog["custom-ai"] ?? {};
    const customSteps: NonNullable<ValidationCatalog[string]["customSteps"]> = { ...(existing.customSteps ?? {}) };
    for (const [id, shape] of customStepShapes) {
      const prior = customSteps[id];
      customSteps[id] = {
        name: prior?.name ?? id,
        requiresSkills: prior?.requiresSkills ?? false,
        defaultSkillIds: prior?.defaultSkillIds ?? [],
        requiresMcp: prior?.requiresMcp ?? false,
        defaultMcpIds: prior?.defaultMcpIds ?? [],
        inputFields: shape.inputFields as ValidationCatalog[string]["inputFields"],
        outputSchema: shape.outputSchema,
      };
    }
    validationCatalog["custom-ai"] = { ...existing, customSteps };
  }
  const inputWarnings = validateWorkflowInputs(definition, validationCatalog);
  for (const w of inputWarnings) {
    if (w.code === "missing-required") continue;
    warnings.push(w.message);
  }

  const hasErrorDiagnostic = diagnostics.some(d => (d.severity ?? "error") === "error");
  return {
    ok: errors.length === 0 && missing.length === 0 && !hasErrorDiagnostic,
    errors, missing, warnings, secretWarnings: [], diagnostics,
  };
}

async function loadCustomStepShapes(
  c: Composition,
  graph: WorkflowGraph,
  proposed?: ProposedCustomStep[],
): Promise<Map<string, CustomStepShape>> {
  const map = new Map<string, CustomStepShape>();
  if (c.pool) {
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type === "step" && n.stepType === "custom-ai") {
        const id = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
    for (const id of ids) {
      const step = await getCustomAiStep(c.pool, id);
      if (step) map.set(id, customStepToShape(step));
    }
  }
  for (const [id, shape] of shapesFromProposedSteps(proposed)) map.set(id, shape);
  return map;
}

function hasWorkflowTrigger(workflow: WorkflowGraph): boolean {
  return workflow.nodes.some(n =>
    n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
  );
}

export function registerWorkflowRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };
  const del = { preHandler: [requireAuth(), requirePerm("resource.delete")] };

  /** Load a workflow and 404 unless it belongs to the route's workspace. */
  async function loadInWorkspace(id: string, wsId: string) {
    const workflow = await c.workflows.getById(id);
    if (!workflow || workflow.workspaceId !== wsId) return null;
    return workflow;
  }

  // Non-destructive validation — caller passes a definition, we return the full report.
  app.post("/workspaces/:wsId/workflows/validate", read, async (req, reply) => {
    const ctx = req.runContext!;
    const body = req.body as { definition?: WorkflowGraph; proposedCustomSteps?: ProposedCustomStep[] };
    if (!body?.definition || typeof body.definition !== "object") {
      reply.code(400);
      return { error: "bad_request", message: "definition is required" };
    }
    const customStepShapes = await loadCustomStepShapes(c, body.definition, body.proposedCustomSteps);
    const report = computeValidationReport(body.definition, customStepShapes);
    const secretWarnings = await computeSaveWarnings(c, ctx, body.definition);

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map((v) => v.name));
    const customAiStepDefaults = new Map<string, { defaultTools?: readonly import("@journeyman/core").CanonicalTool[] }>();
    if (c.pool) {
      const customStepIds = new Set<string>();
      for (const node of body.definition.nodes) {
        if (node.type === "step" && node.stepType === "custom-ai") {
          const id = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
          if (typeof id === "string" && id) customStepIds.add(id);
        }
      }
      for (const id of customStepIds) {
        const step = await getCustomAiStep(c.pool, id);
        if (step) customAiStepDefaults.set(id, { defaultTools: step.defaultTools });
      }
    }
    const publishResult = validateForPublish(body.definition, {
      hasTrigger: hasWorkflowTrigger(body.definition),
      visibleSecretNames,
      stepConfigValidators: buildStepConfigValidators(stepCatalog),
      customAiStepDefaults,
    });
    const seenErrors = new Set(report.errors);
    const seenMissing = new Set(report.missing);
    const seenWarnings = new Set(report.warnings);
    for (const e of publishResult.errors) {
      const label = e.nodeLabel ?? (e.nodeId ? "Unknown step" : "Flow");
      const msg = e.nodeId
        ? `[${label}] (${e.nodeId}) ${e.message}`
        : `[${label}] ${e.message}`;
      if (e.severity === "warning") {
        if (!seenWarnings.has(msg)) { report.warnings.push(msg); seenWarnings.add(msg); }
      } else if (e.code === "missing_config" || e.code === "unresolved_binding") {
        if (!seenMissing.has(msg)) { report.missing.push(msg); seenMissing.add(msg); }
      } else {
        if (!seenErrors.has(msg)) { report.errors.push(msg); seenErrors.add(msg); }
      }
    }
    const customStepDefs = await loadCustomStepShapes(c, body.definition, body.proposedCustomSteps);
    const catalogMap = new Map(stepCatalog.map(p => [
      p.stepType,
      { stepType: p.stepType, inputFields: p.inputFields, outputSchema: p.outputSchema },
    ]));
    try {
      ConductorJsonConverter.validateGraph(body.definition, catalogMap, customStepDefs);
    } catch (e) {
      if (e instanceof WorkflowValidationError && e.diagnostic) {
        const d = e.diagnostic;
        const dup = report.diagnostics.some(x => x.code === d.code && x.nodeId === d.nodeId && x.message === d.message);
        if (!dup) report.diagnostics.push(d);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        if (!seenErrors.has(msg)) {
          report.errors.push(msg);
          seenErrors.add(msg);
        }
      }
    }
    const hasErrorDiagnostic = report.diagnostics.some(d => (d.severity ?? "error") === "error");
    report.ok = report.errors.length === 0 && report.missing.length === 0 && !hasErrorDiagnostic;

    return { ...report, secretWarnings };
  });

  app.post("/workspaces/:wsId/workflows", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId } = req.params as { wsId: string };
    const body = createFlowBody.parse(req.body);

    const warnings = await computeSaveWarnings(c, ctx, body.definition as WorkflowGraph);

    const workflow = await c.workflows.create({
      workspaceId: wsId,
      name: body.name,
      description: body.description,
      initialDefinition: body.definition as WorkflowGraph,
      createdByUserId: ctx.user.id,
    });
    reply.code(201);
    return warnings.length ? { workflow, warnings } : { workflow };
  });

  app.get("/workspaces/:wsId/workflows", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const q = req.query as { limit?: string; page?: string; page_size?: string };

    const paginated = q.page !== undefined || q.page_size !== undefined;
    if (paginated) {
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const requestedSize = Number(q.page_size ?? 25) || 25;
      const pageSize = Math.min(100, Math.max(1, requestedSize));
      const offset = (page - 1) * pageSize;
      const [workflows, total] = await Promise.all([
        c.workflows.list({ workspaceId: wsId, limit: pageSize, offset }),
        c.workflows.count({ workspaceId: wsId }),
      ]);
      return { workflows, total, page, pageSize };
    }

    const workflows = await c.workflows.list({
      workspaceId: wsId,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { workflows };
  });

  app.get("/workspaces/:wsId/workflows/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    return { workflow };
  });

  app.put("/workspaces/:wsId/workflows/:id", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = updateFlowBody.parse(req.body);

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.workflows.updateMeta(id, { name: body.name, description: body.description });
    }
    let warnings: WorkflowSaveWarning[] = [];
    if (body.definition) {
      warnings = await computeSaveWarnings(c, ctx, body.definition as WorkflowGraph);
      await c.workflows.updateDraft(id, {
        definition: body.definition as WorkflowGraph,
        updatedByUserId: ctx.user.id,
      });
    }
    const updated = await c.workflows.getById(id);
    return warnings.length ? { workflow: updated, warnings } : { workflow: updated };
  });

  app.delete("/workspaces/:wsId/workflows/:id", del, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (workflow.status !== "draft") { reply.code(409); return { error: "not_draft" }; }
    await c.workflows.delete(id);
    reply.code(204).send();
  });

  app.get("/workspaces/:wsId/workflows/:id/versions/current", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!workflow.publishedVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.publishedVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });

  app.get("/workspaces/:wsId/workflows/:id/versions", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    const versions = await c.workflowVersions.listByWorkflow(id);
    const list = versions
      .slice()
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        createdAt: v.createdAt,
        createdByUserId: v.createdByUserId,
        isPublished: v.id === workflow.publishedVersionId,
      }));
    return { versions: list };
  });

  app.get("/workspaces/:wsId/workflow_versions/:id", read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const version = await c.workflowVersions.getById(id);
    if (!version) { reply.code(404); return { error: "not_found" }; }
    return { version };
  });

  app.post("/workspaces/:wsId/workflows/:id/promote", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    const definition = workflow.draftDefinition;

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    const customAiStepDefaults = new Map<string, { defaultTools?: readonly import("@journeyman/core").CanonicalTool[] }>();
    if (c.pool) {
      const customStepIds = new Set<string>();
      for (const node of definition.nodes) {
        if (node.type === "step" && node.stepType === "custom-ai") {
          const cid = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
          if (typeof cid === "string" && cid) customStepIds.add(cid);
        }
      }
      for (const cid of customStepIds) {
        const step = await getCustomAiStep(c.pool, cid);
        if (step) customAiStepDefaults.set(cid, { defaultTools: step.defaultTools });
      }
    }

    try {
      const customStepDefs = await loadCustomStepShapes(c, definition);
      const catalogMap = new Map(stepCatalog.map(p => [
        p.stepType,
        { stepType: p.stepType, inputFields: p.inputFields, outputSchema: p.outputSchema },
      ]));
      ConductorJsonConverter.validateGraph(definition, catalogMap, customStepDefs);
    } catch (e) {
      reply.code(400);
      if (e instanceof WorkflowValidationError && e.diagnostic) return { errors: [e.diagnostic] };
      return { errors: [{ code: "shape_mismatch", message: e instanceof Error ? e.message : String(e) }] };
    }

    const result = validateForPublish(definition, {
      hasTrigger: hasWorkflowTrigger(definition),
      visibleSecretNames,
      stepConfigValidators: buildStepConfigValidators(stepCatalog),
      customAiStepDefaults,
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors.filter(e => !e.severity || e.severity === "error") }; }

    const promoted = await c.workflows.promote(id, { createdByUserId: ctx.user.id });
    if (!promoted) { reply.code(500); return { error: "update_failed" }; }

    await refreshTriggerIndexOnPublish(c.workflowTriggers, {
      workflowId: promoted.workflow.id,
      workflowVersionId: promoted.version.id,
      graph: definition,
    });

    const warnings = result.errors.filter(e => e.severity === "warning");
    return { workflow: promoted.workflow, version: promoted.version, warnings };
  });

  app.post("/workspaces/:wsId/workflows/:id/rollback", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const { versionId } = (req.body ?? {}) as { versionId?: string };
    if (!versionId) { reply.code(400); return { error: "bad_request", message: "versionId is required" }; }

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    const target = await c.workflowVersions.getById(versionId);
    if (!target || target.workflowId !== id) { reply.code(404); return { error: "version_not_found" }; }

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    try {
      const customStepDefs = await loadCustomStepShapes(c, target.definition);
      const catalogMap = new Map(stepCatalog.map(p => [
        p.stepType,
        { stepType: p.stepType, inputFields: p.inputFields, outputSchema: p.outputSchema },
      ]));
      ConductorJsonConverter.validateGraph(target.definition, catalogMap, customStepDefs);
    } catch (e) {
      reply.code(400);
      if (e instanceof WorkflowValidationError && e.diagnostic) return { errors: [e.diagnostic] };
      return { errors: [{ code: "shape_mismatch", message: e instanceof Error ? e.message : String(e) }] };
    }

    const result = validateForPublish(target.definition, {
      hasTrigger: hasWorkflowTrigger(target.definition),
      visibleSecretNames,
      stepConfigValidators: buildStepConfigValidators(stepCatalog),
      customAiStepDefaults: new Map(),
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors.filter(e => !e.severity || e.severity === "error") }; }

    const updated = await c.workflows.rollback(id, { versionId });
    if (!updated) { reply.code(500); return { error: "update_failed" }; }

    await refreshTriggerIndexOnPublish(c.workflowTriggers, {
      workflowId: updated.id,
      workflowVersionId: versionId,
      graph: target.definition,
    });

    return { workflow: updated };
  });

  app.post("/workspaces/:wsId/workflows/:id/unpublish", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = (req.body ?? {}) as { confirm?: boolean };

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    const inFlightCount = 0;
    const activeTriggers = { webhooks: 0, schedules: 0 };

    if (!body.confirm && (inFlightCount > 0 || activeTriggers.webhooks > 0 || activeTriggers.schedules > 0)) {
      reply.code(409);
      return { warning: { inFlightCount, activeTriggers } };
    }

    const updated = await c.workflows.setStatus(id, "draft");
    if (!updated) { reply.code(500); return { error: "update_failed" }; }
    await refreshTriggerIndexOnUnpublish(c.workflowTriggers, { workflowId: id });
    return { workflow: updated };
  });

  app.post("/workspaces/:wsId/workflows/:id/workflow-instances", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = createRunBody.parse(req.body);

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!assertWorkflowReady(workflow, reply)) return;
    if (!workflow.publishedVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.publishedVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }

    const manualTrigger = findManualTriggerNode(version.definition);
    if (!manualTrigger) {
      reply.code(409);
      return { error: "no_manual_trigger" };
    }

    const { workflowInstanceId, engineWorkflowId } = await c.orchestrator.submit({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowNameSnapshot: workflow.name,
      workspaceId: workflow.workspaceId,
      definitionSnapshot: version.definition,
      inputs: body.inputs,
      startedByUserId: ctx.user.id,
      startedByOrgId: ctx.workspace?.orgId ?? ctx.org.id,
      triggerSource: "manual",
      triggerNodeId: manualTrigger.id,
    });

    reply.code(202);
    return { workflowInstanceId, engineWorkflowId };
  });

  // ----- Snapshot actions -----

  app.post("/workspaces/:wsId/workflows/:id/clone", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await loadInWorkspace(id, wsId);
    if (!src) { reply.code(404); return { error: "not_found" }; }

    const workflow = await c.workflows.create({
      workspaceId: wsId,
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      initialDefinition: src.draftDefinition,
      createdByUserId: ctx.user.id,
    });
    reply.code(201);
    return { id: workflow.id };
  });
}
