import type { WorkflowGraph, WorkflowNode } from "../types/flow.types.ts";
import type { SecretBinding } from "../types/flow.types.ts";
import { isJsonLogicExpr } from "../types/flow-condition.types.ts";

export type PublishError = {
  code:
    | "graph_invalid"
    | "no_trigger"
    | "orphan_node"
    | "missing_config"
    | "unresolved_binding"
    | "invalid_gate"
    | "dangling_reference";
  message: string;
  nodeId?: string;
  fieldPath?: string;
};

export type PublishValidationResult =
  | { ok: true }
  | { ok: false; errors: PublishError[] };

export interface PublishValidationContext {
  visibleSecretNames?: Set<string>;
  visibleMcpInstanceIds?: Set<string>;
  visibleSkillIds?: Set<string>;
  hasTrigger: boolean;
}

export function validateForPublish(
  flow: WorkflowGraph,
  ctx: PublishValidationContext,
): PublishValidationResult {
  const errors: PublishError[] = [];

  pushGraphErrors(flow, errors);

  if (!ctx.hasTrigger) {
    errors.push({
      code: "no_trigger",
      message: "Flow has no trigger configured (webhook, schedule, or manual).",
    });
  }

  pushOrphanErrors(flow, errors);

  for (const node of flow.nodes) {
    pushNodeErrors(flow, node, ctx, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function pushGraphErrors(flow: WorkflowGraph, errors: PublishError[]): void {
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) {
    errors.push({ code: "graph_invalid", message: "Flow must have exactly one start node" });
  }
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    errors.push({ code: "graph_invalid", message: "Flow must have at least one end node" });
  }
  for (const node of flow.nodes) {
    if (node.type === "phase" && !node.phaseType) {
      errors.push({
        code: "graph_invalid",
        message: `Phase node '${node.id}' is missing a phase type`,
        nodeId: node.id,
      });
    }
  }
}

function pushOrphanErrors(flow: WorkflowGraph, errors: PublishError[]): void {
  const start = flow.nodes.find(n => n.type === "start");
  if (!start) return;
  const reachable = new Set<string>([start.id]);
  const stack = [start.id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of flow.edges) {
      if (e.source === cur && !reachable.has(e.target)) {
        reachable.add(e.target);
        stack.push(e.target);
      }
    }
  }
  for (const n of flow.nodes) {
    if (!reachable.has(n.id)) {
      errors.push({
        code: "orphan_node",
        message: `Node '${n.displayName ?? n.id}' is unreachable from start`,
        nodeId: n.id,
      });
    }
  }
}

function pushNodeErrors(
  flow: WorkflowGraph,
  node: WorkflowNode,
  ctx: PublishValidationContext,
  errors: PublishError[],
): void {
  const upstream = collectUpstreamNodeIds(flow, node.id);
  for (const [slot, val] of Object.entries(node.inputs ?? {}) as [string, import("../types/flow.types.ts").WorkflowInputValue][]) {
    if (val && val.kind === "ref" && val.ref) {
      const referencedNodeId = parseRefNodeId(val.ref);
      if (referencedNodeId && !upstream.has(referencedNodeId)) {
        errors.push({
          code: "unresolved_binding",
          message: `Input '${slot}' references node '${referencedNodeId}' which is not upstream of '${node.id}'`,
          nodeId: node.id,
          fieldPath: `inputs.${slot}`,
        });
      }
    }
  }

  if (node.type === "gateway-xor" || node.type === "if") {
    for (const e of flow.edges.filter(edge => edge.source === node.id)) {
      if (e.type === "conditional") {
        if (e.condition === undefined) {
          errors.push({
            code: "invalid_gate",
            message: `Edge ${e.id} on gate '${node.id}' is conditional but has no condition`,
            nodeId: node.id,
          });
        } else if (!isJsonLogicExpr(e.condition)) {
          errors.push({
            code: "invalid_gate",
            message: `Edge ${e.id} on gate '${node.id}' has an invalid condition shape`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  if (ctx.visibleSecretNames && node.secretBindings) {
    for (const [slot, binding] of Object.entries(node.secretBindings as Record<string, SecretBinding>)) {
      const name = binding.mode === "auto" ? slot : binding.name;
      if (!ctx.visibleSecretNames.has(name)) {
        errors.push({
          code: "dangling_reference",
          message: `Secret '${name}' (slot '${slot}') is not visible from this flow`,
          nodeId: node.id,
          fieldPath: `secretBindings.${slot}`,
        });
      }
    }
  }
  if (ctx.visibleMcpInstanceIds) {
    const ids = (node.config as { mcpInstanceIds?: string[] } | undefined)?.mcpInstanceIds ?? [];
    for (const id of ids) {
      if (!ctx.visibleMcpInstanceIds.has(id)) {
        errors.push({
          code: "dangling_reference",
          message: `MCP instance '${id}' is not visible from this flow`,
          nodeId: node.id,
          fieldPath: "config.mcpInstanceIds",
        });
      }
    }
  }
  if (ctx.visibleSkillIds) {
    const skills = (node.config as { skillIds?: string[] } | undefined)?.skillIds ?? [];
    for (const id of skills) {
      if (!ctx.visibleSkillIds.has(id)) {
        errors.push({
          code: "dangling_reference",
          message: `Skill '${id}' is not visible from this flow`,
          nodeId: node.id,
          fieldPath: "config.skillIds",
        });
      }
    }
  }
}

function collectUpstreamNodeIds(flow: WorkflowGraph, target: string): Set<string> {
  const upstream = new Set<string>();
  const stack: string[] = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of flow.edges) {
      if (e.target === cur && !upstream.has(e.source)) {
        upstream.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return upstream;
}

function parseRefNodeId(ref: string): string | null {
  const idx = ref.indexOf(".");
  return idx === -1 ? ref : ref.slice(0, idx);
}
