import type { Composition } from "../composition.ts";
import type { HumanTaskConfig, HumanTaskOutputField, HumanTaskSource } from "@journeyman/core";

export interface ResolveHumanTaskInput {
  runId: string;
  nodeId: string;
  /**
   * Values for the declared output fields. Keys must match `output.name`.
   * Missing required fields (with no default) cause the resolution to be
   * rejected.
   */
  values: Record<string, unknown>;
  /** Free-form payload kept on the artifact (raw webhook body, or { values } for manual). */
  payload?: Record<string, unknown>;
  actor: string | null;
  source: HumanTaskSource;
  webhookEventId?: string | null;
}

export class HumanTaskNotWaitingError extends Error {
  constructor(runId: string, nodeId: string) {
    super(`Human-task ${runId}/${nodeId} is not in waiting state`);
    this.name = "HumanTaskNotWaitingError";
  }
}

export class HumanTaskMissingValueError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required values: ${missing.join(", ")}`);
    this.name = "HumanTaskMissingValueError";
  }
}

export async function resolveHumanTask(c: Composition, input: ResolveHumanTaskInput): Promise<void> {
  const run = await c.runs.getById(input.runId);
  if (!run) throw new Error(`run ${input.runId} not found`);

  const node = run.definitionSnapshot.nodes.find(n => n.id === input.nodeId);
  if (!node || node.type !== "human-task") {
    throw new Error(`node ${input.nodeId} on run ${input.runId} is not a human-task`);
  }

  const cfg = (node.config ?? {}) as unknown as HumanTaskConfig;
  const outputs: HumanTaskOutputField[] = Array.isArray(cfg.outputs) ? cfg.outputs : [];

  // Apply defaults for any field not present in values.
  const filled: Record<string, unknown> = { ...input.values };
  for (const o of outputs) {
    if (filled[o.name] === undefined && o.default !== undefined) {
      filled[o.name] = o.default;
    }
  }

  // Validate required fields are present.
  const missing = outputs
    .filter(o => o.required && (filled[o.name] === undefined || filled[o.name] === null || filled[o.name] === ""))
    .map(o => o.name);
  if (missing.length > 0) throw new HumanTaskMissingValueError(missing);

  let exec = await c.nodeExecutions.latestForNode(input.runId, input.nodeId);
  if (!exec || exec.status !== "waiting") {
    throw new HumanTaskNotWaitingError(input.runId, input.nodeId);
  }

  let conductorTaskId = exec.conductorTaskId ?? null;
  if (!conductorTaskId) {
    const { reconcileRun } = await import("./engine-reconciler.ts");
    await reconcileRun(c, input.runId);
    exec = await c.nodeExecutions.latestForNode(input.runId, input.nodeId);
    if (!exec || !exec.conductorTaskId) {
      throw new Error(`No conductor_task_id recorded for ${input.runId}/${input.nodeId}`);
    }
    conductorTaskId = exec.conductorTaskId;
  }

  c.humanTaskTimeouts.cancel(input.runId, input.nodeId);

  await c.humanTaskResolutions.create({
    runId: input.runId,
    nodeId: input.nodeId,
    outcome: pickPrimary(filled), // best-effort: a string field that smells like an outcome
    comment: typeof filled.comment === "string" ? filled.comment : null,
    actor: input.actor,
    source: input.source,
    webhookEventId: input.webhookEventId ?? null,
  });

  const resolvedAt = new Date().toISOString();

  // Top-level artifact: declared outputs spread + reserved meta keys.
  const output: Record<string, unknown> = {
    ...filled,
    source: input.source,
    actor: input.actor,
    resolvedAt,
    payload: input.payload ?? {},
  };

  await c.nodeExecutions.markCompleted(exec.id, output);

  await c.events.append({
    runId: input.runId,
    nodeId: input.nodeId,
    eventType: "node.resolved",
    payload: output,
  });

  if (run.engineWorkflowId) {
    await c.conductorClient.completeTask({
      workflowInstanceId: run.engineWorkflowId,
      taskId: conductorTaskId,
      status: "COMPLETED",
      outputData: output,
    });
  }

  await c.runs.setStatus(input.runId, "running");
}

/**
 * For the audit table's `outcome` column we keep a single primary string —
 * the first declared string field, falling back to "(resolved)". This avoids
 * a schema migration; the real values live in the artifact.
 */
function pickPrimary(values: Record<string, unknown>): string {
  for (const key of Object.keys(values)) {
    const v = values[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "(resolved)";
}
