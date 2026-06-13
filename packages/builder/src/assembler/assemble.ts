import type {
  WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowNodeType,
  WorkflowInputDef, WorkflowInputValue, StepBinding, Gap, StepKind,
} from "@journeyman/core";
import { WORKFLOW_SCHEMA_VERSION } from "@journeyman/core";
import type { AssemblerIntent, StepIntent, TriggerIntent, InputIntent } from "./intent.ts";
import { toInputValue } from "./refs.ts";
import { detectGaps } from "./gaps.ts";
import { compileCondition } from "./conditions.ts";

export interface AssembleDeps {
  /** Reserved for future catalog-driven checks; unused so far. */
  catalog?: unknown;
}

export interface AssembleResult {
  workflow: WorkflowGraph;
  stepBindings: StepBinding[];
  gaps: Gap[];
}

const X_STEP = 240;
const Y = 0;

function triggerNodeType(t: TriggerIntent): WorkflowNodeType {
  switch (t.kind) {
    case "manual":  return "trigger-manual";
    case "webhook": return "trigger-webhook";
    case "form":    return "trigger-human";
  }
}

function stepNodeType(s: StepIntent): WorkflowNodeType {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  return "step";
}

function bindingKind(s: StepIntent): StepKind {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  if (s.kind === "ai") return "ai";
  return "provider";
}

export function assemble(intent: AssemblerIntent, _deps: AssembleDeps = {}): AssembleResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const inputDefs: WorkflowInputDef[] = [];
  const triggerNodeIds: string[] = [];
  const nodeIdByRef: Record<string, string> = {};
  let edgeSeq = 0;
  let stepSeq = 0;
  let col = 0;
  const edge = (source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge => ({
    id: `e_${++edgeSeq}`, source, target, type: "default", ...extra,
  });

  // --- Triggers ---
  intent.triggers.forEach((t, i) => {
    const id = `t_${i + 1}`;
    triggerNodeIds.push(id);
    const config: Record<string, unknown> = {};
    if (t.kind === "webhook") {
      config.webhookId = t.webhookId ?? "";
      if (t.listensFor) config.listensFor = t.listensFor;
      const mapping: Record<string, { fromPath: string; type: string }> = {};
      for (const inp of t.inputs ?? []) {
        mapping[inp.name] = { fromPath: inp.fromPath, type: inp.type };
        inputDefs.push({ name: inp.name, type: inp.type });
      }
      config.inputsMapping = mapping;
    } else if (t.kind === "form") {
      config.fieldOverrides = {};
      for (const inp of t.inputs ?? []) inputDefs.push({ name: inp.name, type: inp.type });
    }
    nodes.push({ id, type: triggerNodeType(t), displayName: t.kind, config, position: { x: col * X_STEP, y: Y } });
  });
  col += 1;

  // --- Assign node ids for ALL steps (main + branch arms + else) up front ---
  const branchSteps = intent.gateway?.branches.flatMap((b) => b.steps) ?? [];
  const elseSteps = intent.gateway?.elseBranch?.steps ?? [];
  const allSteps: StepIntent[] = [...intent.steps, ...branchSteps, ...elseSteps];
  for (const s of allSteps) nodeIdByRef[s.ref] = `n_${++stepSeq}`;

  // --- Per-step node builder (closes over nodeIdByRef) ---
  const buildStepNode = (s: StepIntent, c: number): WorkflowNode => {
    const node: WorkflowNode = {
      id: nodeIdByRef[s.ref], type: stepNodeType(s), displayName: s.label,
      position: { x: c * X_STEP, y: Y },
    };
    const config: Record<string, unknown> = {};
    if (node.type === "step") {
      node.stepType = s.stepType;
      if (s.stepType === "custom-ai" && s.customStepId) config.customStepId = s.customStepId;
      if (s.kind === "ai") {
        if (s.tools) config.tools = s.tools;
        if (s.mcpIds) config.mcpInstanceIds = s.mcpIds;
        if (s.skillIds) config.skillIds = s.skillIds;
      }
      if (s.provider) node.executorConfig = { provider: s.provider };
      if (s.model) node.model = s.model;
      if (s.sandboxId) node.sandboxId = s.sandboxId;
    } else if (node.type === "webhook-wait") {
      config.webhookId = s.waitWebhookId ?? "";
    } else if (node.type === "human-task") {
      if (s.assignee) config.assignee = s.assignee;
      if (s.taskPrompt) config.prompt = s.taskPrompt;
    }
    node.config = config;
    if (s.inputs && s.inputs.length > 0) {
      const inputs: Record<string, WorkflowInputValue> = {};
      for (const b of s.inputs) inputs[b.slot] = toInputValue(remapInput(b.value, nodeIdByRef));
      node.inputs = inputs;
    }
    return node;
  };

  const endId = "end";

  // --- Main chain nodes + edges ---
  const mainIds = intent.steps.map((s) => nodeIdByRef[s.ref]);
  intent.steps.forEach((s) => { nodes.push(buildStepNode(s, col++)); });
  for (let i = 0; i < mainIds.length - 1; i++) edges.push(edge(mainIds[i], mainIds[i + 1]));

  if (intent.gateway) {
    const g = intent.gateway;
    const gId = "g_1";
    // triggers → first main step, or directly to the gateway if there are no main steps
    const firstTarget = mainIds[0] ?? gId;
    for (const tId of triggerNodeIds) edges.push(edge(tId, firstTarget));
    // last main step → gateway
    if (mainIds.length) edges.push(edge(mainIds[mainIds.length - 1], gId));
    nodes.push({ id: gId, type: "gateway-xor", displayName: g.label, config: {}, position: { x: col++ * X_STEP, y: Y } });

    const buildArm = (steps: StepIntent[], gatewayEdgeExtra: Partial<WorkflowEdge>) => {
      const armIds = steps.map((s) => nodeIdByRef[s.ref]);
      steps.forEach((s) => nodes.push(buildStepNode(s, col++)));
      edges.push(edge(gId, armIds[0] ?? endId, gatewayEdgeExtra));
      for (let i = 0; i < armIds.length - 1; i++) edges.push(edge(armIds[i], armIds[i + 1]));
      if (armIds.length) edges.push(edge(armIds[armIds.length - 1], endId));
    };
    for (const b of g.branches) {
      buildArm(b.steps, { type: "conditional", branchLabel: b.label, condition: compileCondition(b.condition, nodeIdByRef) });
    }
    if (g.elseBranch) buildArm(g.elseBranch.steps, { type: "else" });
  } else {
    // No gateway: plain linear chain (unchanged behavior).
    const firstTarget = mainIds[0] ?? endId;
    for (const tId of triggerNodeIds) edges.push(edge(tId, firstTarget));
    if (mainIds.length) edges.push(edge(mainIds[mainIds.length - 1], endId));
  }

  // --- end node ---
  nodes.push({ id: endId, type: "end", displayName: "End", config: {}, position: { x: col * X_STEP, y: Y } });

  // --- step bindings (all steps, main + arms) ---
  const stepBindings: StepBinding[] = allSteps.map((s) => buildBinding(s, nodeIdByRef));

  // --- gaps (flatten arm steps into the intent passed to detectGaps) ---
  const gaps = detectGaps(
    { summary: intent.summary, triggers: intent.triggers, steps: allSteps },
    { nodeIdByRef, triggerNodeIds },
  );

  const workflow: WorkflowGraph = { schemaVersion: WORKFLOW_SCHEMA_VERSION, nodes, edges, inputDefs };
  return { workflow, stepBindings, gaps };
}

function buildBinding(s: StepIntent, nodeIdByRef: Record<string, string>): StepBinding {
  const uses: StepBinding["uses"] = {};
  if (s.kind === "ai") {
    if (s.tools) uses.tools = s.tools;
    if (s.mcpIds) uses.mcpIds = s.mcpIds;
    if (s.skillIds) uses.skillIds = s.skillIds;
    if (s.model) uses.model = s.model;
  } else if (s.kind === "provider" && s.connection) {
    uses.connection = s.connection;
  }
  if (s.sandboxId) uses.sandboxId = s.sandboxId;
  if (s.secrets) uses.secrets = s.secrets;
  const inputs = (s.inputs ?? []).map((b) => ({ name: b.slot, from: describeFrom(b.value) }));
  return { nodeId: nodeIdByRef[s.ref], stepKind: bindingKind(s), uses, io: { inputs, outputs: [] } };
}

/** Rewrite an InputIntent's intent-local step handles to assigned node ids. */
function remapInput(v: InputIntent, nodeIdByRef: Record<string, string>): InputIntent {
  if (v.from === "step-output") return { ...v, stepRef: nodeIdByRef[v.stepRef] ?? v.stepRef };
  if (v.from === "template") return { from: "template", template: remapTemplate(v.template, nodeIdByRef) };
  return v;
}

/** In a `{{ ref }}` template, rewrite `<intentRef>.output|input.<field>` tokens to node ids. */
function remapTemplate(tpl: string, nodeIdByRef: Record<string, string>): string {
  return tpl.replace(/\{\{(.+?)\}\}/g, (full, inner) => {
    const ref = String(inner).trim();
    const m = /^([^.]+)\.(output|input)\.(.+)$/.exec(ref);
    if (m && nodeIdByRef[m[1]]) return `{{ ${nodeIdByRef[m[1]]}.${m[2]}.${m[3]} }}`;
    return full;
  });
}

/** Human-readable source description for the inputs/outputs (⇄) reveal. */
function describeFrom(v: InputIntent): string {
  switch (v.from) {
    case "literal":            return "a fixed value";
    case "workflow-input":     return `flow input ${v.name}`;
    case "workflow-attribute": return `flow attribute ${v.name}`;
    case "step-output":        return `step ${v.stepRef} · output ${v.field}`;
    case "template":           return "a template";
    default:                   return "unknown";
  }
}
