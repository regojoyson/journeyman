import type { BuildPlan, CanonicalTool, StepBinding, WorkflowNode } from "@journeyman/core";

/** Replace the node with the given id by `fn(node)`, returning a new plan. Pure. */
function mapNode(plan: BuildPlan, nodeId: string, fn: (n: WorkflowNode) => WorkflowNode): BuildPlan {
  return {
    ...plan,
    workflow: {
      ...plan.workflow,
      nodes: plan.workflow.nodes.map((n) => (n.id === nodeId ? fn(n) : n)),
    },
  };
}

/** Replace the binding for the given node id by `fn(binding)`, returning a new plan. Pure. */
function mapBinding(plan: BuildPlan, nodeId: string, fn: (b: StepBinding) => StepBinding): BuildPlan {
  return {
    ...plan,
    stepBindings: plan.stepBindings.map((b) => (b.nodeId === nodeId ? fn(b) : b)),
  };
}

function withConfig(n: WorkflowNode, patch: Record<string, unknown>): WorkflowNode {
  return { ...n, config: { ...(n.config ?? {}), ...patch } };
}

/** Change (or clear, when empty) a step's model override. Updates node + binding. */
export function setStepModel(plan: BuildPlan, nodeId: string, model: string): BuildPlan {
  const value = model.trim() === "" ? null : model.trim();
  const p = mapNode(plan, nodeId, (n) => ({ ...n, model: value }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, model: value ?? undefined } }));
}

/** Toggle one canonical tool on/off for an AI step. Updates node.config.tools + binding. */
export function toggleStepTool(plan: BuildPlan, nodeId: string, tool: CanonicalTool): BuildPlan {
  const node = plan.workflow.nodes.find((n) => n.id === nodeId);
  const current = ((node?.config?.tools as CanonicalTool[] | undefined) ?? []);
  const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
  const p = mapNode(plan, nodeId, (n) => withConfig(n, { tools: next }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, tools: next } }));
}

/** Set the MCP instance ids an AI step uses. Updates node.config.mcpInstanceIds + binding. */
export function setStepMcpIds(plan: BuildPlan, nodeId: string, ids: string[]): BuildPlan {
  const p = mapNode(plan, nodeId, (n) => withConfig(n, { mcpInstanceIds: ids }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, mcpIds: ids } }));
}

/** Set (or clear) a step's sandbox override. Updates node.sandboxId + binding. */
export function setStepSandbox(plan: BuildPlan, nodeId: string, sandboxId: string | null): BuildPlan {
  const p = mapNode(plan, nodeId, (n) => ({ ...n, sandboxId: sandboxId ?? undefined }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, sandboxId: sandboxId ?? undefined } }));
}

/**
 * Map a credential slot to a vault secret by name (convention; value never carried).
 * Records the choice in the binding for display. The final per-slot wiring on a
 * custom-AI step is completed in the flow editor; here it lets the user close a
 * connection gap (see `resolveGap`) without leaving the Builder.
 */
export function mapSecretSlot(plan: BuildPlan, nodeId: string, slot: string, secretName: string | null): BuildPlan {
  return mapBinding(plan, nodeId, (b) => {
    const secrets = [...(b.uses.secrets ?? [])];
    const i = secrets.findIndex((s) => s.slot === slot);
    if (i >= 0) secrets[i] = { slot, secretName };
    else secrets.push({ slot, secretName });
    return { ...b, uses: { ...b.uses, secrets } };
  });
}

export function setDefaultModel(plan: BuildPlan, model: string): BuildPlan {
  return { ...plan, defaults: { ...plan.defaults, model: model.trim() === "" ? null : model.trim() } };
}

export function setDefaultSandbox(plan: BuildPlan, sandboxId: string | null): BuildPlan {
  return { ...plan, defaults: { ...plan.defaults, sandboxId } };
}

/** Acknowledge/resolve a gap by removing it from the list (unblocks the Apply gate). */
export function resolveGap(plan: BuildPlan, gapId: string): BuildPlan {
  return { ...plan, gaps: plan.gaps.filter((g) => g.id !== gapId) };
}
