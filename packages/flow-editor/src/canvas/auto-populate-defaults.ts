import type { WorkflowNode, CustomAiStep } from "@journeyman/core";

/**
 * Copy a custom step definition's defaults into a freshly created node.
 * Only fills `skillPackageIds` if the node has none yet — never overrides an existing pick.
 */
export function autoPopulateCustomAiDefaults(
  node: WorkflowNode,
  def: CustomAiStep | null,
): WorkflowNode {
  if (node.type !== "step" || node.stepType !== "custom-ai") return node;
  if (!def) return node;
  const cfg = (node.config ?? {}) as { skillPackageIds?: unknown };
  const hasSkills = Array.isArray(cfg.skillPackageIds) && cfg.skillPackageIds.length > 0;
  if (hasSkills) return node;
  if (!def.defaultSkillIds.length) return node;
  return {
    ...node,
    config: { ...cfg, skillPackageIds: [...def.defaultSkillIds] },
  };
}
