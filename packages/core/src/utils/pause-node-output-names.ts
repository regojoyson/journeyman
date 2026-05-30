import type { WorkflowNode } from "../types/flow.types.ts";
import { WEBHOOK_WAIT_RESERVED_KEYS } from "../types/webhook-wait.types.ts";
import { HUMAN_TASK_RESERVED_KEYS } from "../types/human-task.types.ts";

export type PauseOutputNameReason = "reserved" | "duplicate" | "invalid";

export interface PauseOutputNameProblem {
  name: string;
  /** Position in `config.outputs` — lets the editor target the offending row. */
  index: number;
  reason: PauseOutputNameReason;
  /** User-facing message that says what to do. */
  message: string;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate the declared output names on a `webhook-wait` / `human-task` node.
 * Returns one problem per offending output (check order: invalid → reserved →
 * duplicate, first match wins). Returns `[]` for clean sets and non-pause nodes.
 * Mirrors the converter's `validateOutputNames` rules so the editor catches the
 * same problems early.
 */
export function validatePauseNodeOutputNames(node: WorkflowNode): PauseOutputNameProblem[] {
  if (node.type !== "webhook-wait" && node.type !== "human-task") return [];

  const reserved = new Set<string>(
    node.type === "webhook-wait" ? WEBHOOK_WAIT_RESERVED_KEYS : HUMAN_TASK_RESERVED_KEYS,
  );
  const outputs = ((node.config ?? {}) as { outputs?: Array<{ name?: unknown }> }).outputs ?? [];

  const problems: PauseOutputNameProblem[] = [];
  const seen = new Set<string>();

  outputs.forEach((o, index) => {
    const name = typeof o?.name === "string" ? o.name : "";

    if (!NAME_RE.test(name)) {
      problems.push({
        name,
        index,
        reason: "invalid",
        message: `'${name}' is invalid — use letters, numbers, underscore; don't start with a digit.`,
      });
      return;
    }
    if (reserved.has(name)) {
      problems.push({ name, index, reason: "reserved", message: `'${name}' is reserved — pick another name.` });
      return;
    }
    if (seen.has(name)) {
      problems.push({ name, index, reason: "duplicate", message: `Duplicate output name '${name}'.` });
      return;
    }
    seen.add(name);
  });

  return problems;
}
