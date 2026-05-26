import type { WorkflowGraph, WorkflowNode } from "../types/flow.types.ts";
import type { SecretBinding } from "../types/flow.types.ts";
import { findTriggerNodes, isTriggerNode } from "../types/flow.types.ts";
import { isJsonLogicExpr } from "../types/flow-condition.types.ts";
import { toolsRequireWorkspace, type CanonicalTool } from "../types/coding-tools.types.ts";
import { extractTemplateRefs } from "../utils/template-refs.ts";
import { validateForkJoinPairs } from "./validate-fork-join-pairs.ts";

export type PublishError = {
  severity?: "error" | "warning"; // absent means "error"
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
  /** Human-readable label for the offending node — UI chip text. Resolved from
   *  `displayName` ?? prettified `stepType` ?? capitalized `type`. */
  nodeLabel?: string;
  fieldPath?: string;
};

export type PublishValidationResult = {
  ok: boolean; // true when no error-severity items
  errors: PublishError[];
};

export type StepConfigIssue = { path: (string | number)[]; message: string };
export type StepConfigValidator = (config: unknown) => StepConfigIssue[];

export interface PublishValidationContext {
  visibleSecretNames?: Set<string>;
  visibleMcpInstanceIds?: Set<string>;
  visibleSkillIds?: Set<string>;
  hasTrigger: boolean;
  /** Per-step config validators keyed by stepType. Empty issues array means valid. */
  stepConfigValidators?: Map<string, StepConfigValidator>;
  /**
   * Defaults for custom-ai steps referenced by `custom-ai` nodes, keyed by step id.
   * Used to compute effective tools when a node hasn't overridden `config.tools`.
   * Caller (api-server) pre-loads these from the DB before validating.
   */
  customAiStepDefaults?: Map<string, { defaultTools?: readonly CanonicalTool[] }>;
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

  const nodeById = new Map(flow.nodes.map(n => [n.id, n]));
  for (const e of validateForkJoinPairs(flow)) {
    const n = nodeById.get(e.nodeId);
    errors.push({
      code: "graph_invalid",
      message: e.message,
      nodeId: e.nodeId,
      nodeLabel: n ? nodeLabelFor(n) : undefined,
    });
  }

  for (const node of flow.nodes) {
    pushNodeErrors(flow, node, ctx, errors);
  }

  const hasError = errors.some(e => !e.severity || e.severity === "error");
  return { ok: !hasError, errors };
}

function pushGraphErrors(flow: WorkflowGraph, errors: PublishError[]): void {
  const triggers = findTriggerNodes(flow);
  if (triggers.length === 0) {
    errors.push({
      code: "no_trigger",
      message: "Workflow must declare at least one trigger node (manual, webhook, or human form).",
    });
  }
  for (const t of triggers) {
    const hasInbound = flow.edges.some(e => e.target === t.id);
    if (hasInbound) {
      errors.push({
        code: "graph_invalid",
        message: `Trigger node must not have inbound edges`,
        nodeId: t.id,
        nodeLabel: nodeLabelFor(t),
      });
    }
    if (t.type === "trigger-webhook") {
      const webhookId = (t.config as { webhookId?: string } | undefined)?.webhookId;
      if (!webhookId) {
        errors.push({
          code: "missing_config",
          message: `trigger-webhook must reference a webhookId`,
          nodeId: t.id,
          nodeLabel: nodeLabelFor(t),
        });
      }
    }
  }
  // Only one manual trigger per workflow (the Run button has exactly one target).
  const manualCount = triggers.filter(t => t.type === "trigger-manual").length;
  if (manualCount > 1) {
    errors.push({
      code: "graph_invalid",
      message: "Workflow may declare at most one manual trigger",
    });
  }
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    errors.push({ code: "graph_invalid", message: "Flow must have at least one end node" });
  }
  // Only Join and End may legitimately aggregate multiple upstream branches.
  // Every other node type (regular step, If, Fork, Loop, Human Task, etc.)
  // is single-input — multiple incoming default edges would mean the worker
  // can't decide which upstream's output to use and may execute the node more
  // than once. Triggers are checked separately above.
  const defaultIncomingCount = new Map<string, number>();
  for (const e of flow.edges) {
    if ((e.type ?? "default") !== "default") continue;
    defaultIncomingCount.set(e.target, (defaultIncomingCount.get(e.target) ?? 0) + 1);
  }
  for (const node of flow.nodes) {
    if (node.type === "join" || node.type === "end") continue;
    if (isTriggerNode(node)) continue;
    const n = defaultIncomingCount.get(node.id) ?? 0;
    if (n > 1) {
      const label = nodeLabelFor(node);
      errors.push({
        code: "graph_invalid",
        message: `"${label}" has ${n} incoming arrows. To merge multiple paths into a single step, add a Join node before it — the Join will wait for the upstream branches and then continue into "${label}".`,
        nodeId: node.id,
        nodeLabel: label,
      });
    }
  }
  for (const node of flow.nodes) {
    if (node.type === "step" && !node.stepType) {
      errors.push({
        code: "graph_invalid",
        message: `Step node is missing a step type`,
        nodeId: node.id,
        nodeLabel: nodeLabelFor(node),
      });
    }
  }
}

function pushOrphanErrors(flow: WorkflowGraph, errors: PublishError[]): void {
  const triggers = findTriggerNodes(flow);
  if (triggers.length === 0) return;
  const reachable = new Set<string>();
  const stack: string[] = [];
  for (const t of triggers) {
    reachable.add(t.id);
    stack.push(t.id);
  }
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
        message: `Node is unreachable from any trigger`,
        nodeId: n.id,
        nodeLabel: nodeLabelFor(n),
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
    const refs: string[] = [];
    if (val && val.kind === "ref" && val.ref) refs.push(val.ref);
    if (val && val.kind === "template" && val.template) {
      for (const seg of extractTemplateRefs(val.template)) refs.push(seg.ref);
    }
    for (const ref of refs) {
      // `workflow.input.*` is a pseudo-source for run inputs declared on the
      // start node. validateWorkflowInputs handles the declaration check —
      // skip the upstream-node check here.
      if (ref.startsWith("workflow.input.")) continue;
      const referencedNodeId = parseRefNodeId(ref);
      if (referencedNodeId && !upstream.has(referencedNodeId)) {
        errors.push({
          code: "unresolved_binding",
          message: `Input '${slot}' references node '${referencedNodeId}' which is not upstream`,
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
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
            message: `Edge ${e.id} is conditional but has no condition`,
            nodeId: node.id,
            nodeLabel: nodeLabelFor(node),
          });
        } else if (!isJsonLogicExpr(e.condition)) {
          errors.push({
            code: "invalid_gate",
            message: `Edge ${e.id} has an invalid condition shape`,
            nodeId: node.id,
            nodeLabel: nodeLabelFor(node),
          });
        }
      }
    }
  }

  if (node.type === "step" && node.stepType === "custom-ai") {
    const cfg = (node.config ?? {}) as { tools?: unknown; customStepId?: unknown };
    const nodeTools = Array.isArray(cfg.tools) ? (cfg.tools as CanonicalTool[]) : undefined;
    let effectiveTools: readonly CanonicalTool[] | undefined = nodeTools;
    if (!effectiveTools && typeof cfg.customStepId === "string" && ctx.customAiStepDefaults) {
      effectiveTools = ctx.customAiStepDefaults.get(cfg.customStepId)?.defaultTools;
    }
    if (effectiveTools && toolsRequireWorkspace(effectiveTools)) {
      const inputs = node.inputs ?? {};
      if (inputs.workspaceDir == null) {
        errors.push({
          code: "missing_config",
          message:
            "Custom step selected workspace tools (bash/read-file/write-file/edit-file/search) " +
            "but no workspaceDir input is wired on this node",
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
          fieldPath: "inputs.workspaceDir",
        });
      }
    }
  }

  if (node.type === "step" && node.stepType && ctx.stepConfigValidators) {
    const validator = ctx.stepConfigValidators.get(node.stepType);
    if (validator) {
      // Keys that are bound via node.inputs satisfy the runtime; their
      // config slots may legitimately be empty. Don't surface schema issues
      // whose root key is bound.
      const boundInputKeys = new Set(
        Object.entries(node.inputs ?? {})
          .filter(([, v]) => {
            const val = v as import("../types/flow.types.ts").WorkflowInputValue | undefined;
            if (!val) return false;
            if (val.kind === "ref") return typeof val.ref === "string" && val.ref.trim().length > 0;
            if (val.kind === "literal") return val.value !== undefined;
            if (val.kind === "template") return typeof val.template === "string" && val.template.trim().length > 0;
            return false;
          })
          .map(([k]) => k),
      );
      const issues = validator(node.config ?? {});
      for (const issue of issues) {
        if (issue.path.length > 0 && boundInputKeys.has(String(issue.path[0]))) continue;
        const path = issue.path.join(".");
        errors.push({
          code: "missing_config",
          message: `${issue.message}${path ? ` (config.${path})` : ""}`,
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
          fieldPath: path ? `config.${path}` : "config",
        });
      }
    }
  }

  if (ctx.visibleSecretNames && node.secretBindings) {
    for (const [slot, binding] of Object.entries(node.secretBindings as Record<string, SecretBinding>)) {
      const name = binding.mode === "auto" ? slot : binding.name;
      if (!ctx.visibleSecretNames.has(name)) {
        errors.push({
          severity: "warning",
          code: "dangling_reference",
          message: `Secret '${name}' (slot '${slot}') is not visible from this flow`,
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
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
          severity: "warning",
          code: "dangling_reference",
          message: `MCP instance '${id}' is not visible from this flow`,
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
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
          severity: "warning",
          code: "dangling_reference",
          message: `Skill '${id}' is not visible from this flow`,
          nodeId: node.id,
          nodeLabel: nodeLabelFor(node),
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

function nodeLabelFor(node: WorkflowNode): string {
  if (node.displayName && node.displayName.trim().length > 0) return node.displayName;
  if (node.type === "step" && node.stepType) return prettifyStepType(node.stepType);
  return capitalize(node.type);
}

function prettifyStepType(stepType: string): string {
  return stepType
    .split(/[-_]/)
    .filter(s => s.length > 0)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
