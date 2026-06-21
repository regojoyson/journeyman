import type { Connectivity, ExecutionMode, SandboxType } from "@journeyman/core";
import type { Sandbox, SandboxScope } from "@journeyman/core";
import { SANDBOX_CATALOG } from "./sandbox-catalog.ts";

export class InvalidSandboxInputError extends Error {}

const WORKER_TYPES: SandboxType[] = [
  "local", "docker", "machine-linux", "machine-windows", "ecs", "ec2", "kubernetes", "cloud",
];
const MODES: ExecutionMode[] = ["per-instance", "shared"];
const CONNECTIVITY: Connectivity[] = ["push", "agent"];

export interface SandboxInputShape {
  name?: unknown;
  type?: unknown;
  executionMode?: unknown;
  connectivity?: unknown;
  maxConcurrentInstances?: unknown;
}

/** Validate an optional per-sandbox concurrency cap. null/0 = unlimited. Throws InvalidSandboxInputError. */
export function validateMaxConcurrentInstances(v: unknown): void {
  if (v === undefined || v === null) return;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10000) {
    throw new InvalidSandboxInputError(
      `maxConcurrentInstances must be an integer between 0 and 10000 (got ${String(v)})`,
    );
  }
}

/** Validate the shape of a create/update worker request body. Throws InvalidSandboxInputError. */
export function validateSandboxInput(input: SandboxInputShape): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new InvalidSandboxInputError("worker name is required");
  }
  if (!WORKER_TYPES.includes(input.type as SandboxType)) {
    throw new InvalidSandboxInputError(`unknown worker type '${String(input.type)}'`);
  }
  if (!MODES.includes(input.executionMode as ExecutionMode)) {
    throw new InvalidSandboxInputError(`unknown executionMode '${String(input.executionMode)}'`);
  }
  if (
    input.connectivity !== undefined &&
    input.connectivity !== null &&
    !CONNECTIVITY.includes(input.connectivity as Connectivity)
  ) {
    throw new InvalidSandboxInputError(`unknown connectivity '${String(input.connectivity)}'`);
  }
  // Reject (type, mode, connectivity) combinations the catalog doesn't support.
  const desc = SANDBOX_CATALOG.find((d) => d.type === input.type);
  if (desc) {
    if (!desc.supportedModes.includes(input.executionMode as ExecutionMode)) {
      throw new InvalidSandboxInputError(
        `${desc.type} does not support executionMode '${String(input.executionMode)}' (allowed: ${desc.supportedModes.join(", ")})`,
      );
    }
    const conn = input.connectivity;
    if (conn !== undefined && conn !== null && !desc.supportedConnectivity.includes(conn as Connectivity)) {
      throw new InvalidSandboxInputError(
        `${desc.type} does not support connectivity '${String(conn)}' (allowed: ${desc.supportedConnectivity.join(", ") || "none"})`,
      );
    }
  }
  validateMaxConcurrentInstances(input.maxConcurrentInstances);
}

/** Map a jm_sandboxes DB row (snake_case) to a Sandbox (camelCase). */
export function rowToSandbox(r: Record<string, any>): Sandbox {
  return {
    id: r.id,
    scope: r.scope as SandboxScope,
    orgId: r.org_id ?? null,
    name: r.name,
    type: r.type as SandboxType,
    executionMode: r.execution_mode as ExecutionMode,
    connectivity: (r.connectivity ?? null) as Connectivity | null,
    config: (r.config ?? {}) as Record<string, unknown>,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    enabled: Boolean(r.enabled),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    imageState: (r.image_state ?? "none") as Sandbox["imageState"],
    imageFingerprint: r.image_fingerprint ?? null,
    imageRef: r.image_ref ?? null,
    imageError: r.image_error ?? null,
    imageBuiltAt: r.image_built_at ?? null,
    maxConcurrentInstances: r.max_concurrent_instances ?? null,
  };
}
