import type { Connectivity, ExecutionMode, ComputeTargetType } from "@journeyman/core";
import type { ComputeTarget, ComputeTargetScope } from "@journeyman/core";

export class InvalidComputeTargetInputError extends Error {}

const WORKER_TYPES: ComputeTargetType[] = [
  "local", "docker", "machine-linux", "machine-windows", "ecs", "ec2", "kubernetes", "cloud",
];
const MODES: ExecutionMode[] = ["per-instance", "shared"];
const CONNECTIVITY: Connectivity[] = ["push", "agent"];

export interface ComputeTargetInputShape {
  name?: unknown;
  type?: unknown;
  executionMode?: unknown;
  connectivity?: unknown;
}

/** Validate the shape of a create/update worker request body. Throws InvalidComputeTargetInputError. */
export function validateComputeTargetInput(input: ComputeTargetInputShape): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new InvalidComputeTargetInputError("worker name is required");
  }
  if (!WORKER_TYPES.includes(input.type as ComputeTargetType)) {
    throw new InvalidComputeTargetInputError(`unknown worker type '${String(input.type)}'`);
  }
  if (!MODES.includes(input.executionMode as ExecutionMode)) {
    throw new InvalidComputeTargetInputError(`unknown executionMode '${String(input.executionMode)}'`);
  }
  if (
    input.connectivity !== undefined &&
    input.connectivity !== null &&
    !CONNECTIVITY.includes(input.connectivity as Connectivity)
  ) {
    throw new InvalidComputeTargetInputError(`unknown connectivity '${String(input.connectivity)}'`);
  }
}

/** Map a jm_compute_targets DB row (snake_case) to a ComputeTarget (camelCase). */
export function rowToComputeTarget(r: Record<string, any>): ComputeTarget {
  return {
    id: r.id,
    scope: r.scope as ComputeTargetScope,
    orgId: r.org_id ?? null,
    userId: r.user_id ?? null,
    name: r.name,
    type: r.type as ComputeTargetType,
    executionMode: r.execution_mode as ExecutionMode,
    connectivity: (r.connectivity ?? null) as Connectivity | null,
    config: (r.config ?? {}) as Record<string, unknown>,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    enabled: Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    imageState: (r.image_state ?? "none") as ComputeTarget["imageState"],
    imageFingerprint: r.image_fingerprint ?? null,
    imageRef: r.image_ref ?? null,
    imageError: r.image_error ?? null,
    imageBuiltAt: r.image_built_at ?? null,
  };
}
