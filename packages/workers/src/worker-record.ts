import type { Connectivity, ExecutionMode, WorkerType } from "@journeyman/core";
import type { WorkerRecord, WorkerScope } from "@journeyman/core";

export class InvalidWorkerInputError extends Error {}

const WORKER_TYPES: WorkerType[] = [
  "local", "docker", "machine-linux", "machine-windows", "ecs", "ec2", "kubernetes", "cloud",
];
const MODES: ExecutionMode[] = ["per-instance", "shared"];
const CONNECTIVITY: Connectivity[] = ["push", "agent"];

export interface WorkerInputShape {
  name?: unknown;
  type?: unknown;
  executionMode?: unknown;
  connectivity?: unknown;
}

/** Validate the shape of a create/update worker request body. Throws InvalidWorkerInputError. */
export function validateWorkerInput(input: WorkerInputShape): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new InvalidWorkerInputError("worker name is required");
  }
  if (!WORKER_TYPES.includes(input.type as WorkerType)) {
    throw new InvalidWorkerInputError(`unknown worker type '${String(input.type)}'`);
  }
  if (!MODES.includes(input.executionMode as ExecutionMode)) {
    throw new InvalidWorkerInputError(`unknown executionMode '${String(input.executionMode)}'`);
  }
  if (
    input.connectivity !== undefined &&
    input.connectivity !== null &&
    !CONNECTIVITY.includes(input.connectivity as Connectivity)
  ) {
    throw new InvalidWorkerInputError(`unknown connectivity '${String(input.connectivity)}'`);
  }
}

/** Map a jm_workers DB row (snake_case) to a WorkerRecord (camelCase). */
export function rowToWorker(r: Record<string, any>): WorkerRecord {
  return {
    id: r.id,
    scope: r.scope as WorkerScope,
    orgId: r.org_id ?? null,
    userId: r.user_id ?? null,
    name: r.name,
    type: r.type as WorkerType,
    executionMode: r.execution_mode as ExecutionMode,
    connectivity: (r.connectivity ?? null) as Connectivity | null,
    config: (r.config ?? {}) as Record<string, unknown>,
    isDefault: Boolean(r.is_default),
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    enabled: Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
