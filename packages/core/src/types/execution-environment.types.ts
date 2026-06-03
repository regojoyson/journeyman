/**
 * Pluggable execution-environment abstraction. A Worker is a configured instance
 * of a worker *type*; each type is a backend implementing IExecutionEnvironment.
 * See docs/superpowers/specs/2026-05-30-workers-managed-compute-targets-design.md.
 */

import type { Readable } from "node:stream";

/** A streamable set of files to deliver into an environment (a tar stream/buffer). */
export interface FileBundle {
  /** tar stream or buffer whose entries are relative paths under the destination dir. */
  tar: Readable | Buffer;
}

export type ComputeTargetType =
  | "local"
  | "docker"
  | "machine-linux"
  | "machine-windows"
  | "ecs"
  | "ec2"
  | "kubernetes"
  | "cloud";

export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";

/** Resolved, ready-to-provision spec (built from a Worker's config at run start). */
export interface ExecutionEnvironmentSpec {
  imageRef?: string;
  env?: Record<string, string>;
  resources?: { cpus?: number; memoryMb?: number; timeoutSec?: number };
  network?: "none" | "full";
  mounts?: Array<{ source: string; target: string; readOnly?: boolean }>;
}

/** Handle to a provisioned environment for a single run. */
export interface ProvisionedEnv {
  runId: string;
  type: ComputeTargetType;
  /** Opaque backend handle (e.g. container id, or "local:<runId>"). */
  handle: string;
  /** Optional named volume (Docker). */
  volume?: string;
  /** Absolute path steps should treat as their workspace (e.g. "/workspace" or a local dir). */
  workspaceDir: string;
}

/** A single operation to run inside the environment. */
export interface ExecOp {
  /** Operation id, e.g. "analyze" | "plan" | "implement" | "custom-prompt" | "clone". */
  op: string;
  /** Coding provider key for this op (e.g. "claude"). Selects the SDK in the runner. */
  provider?: string;
  /** JSON request payload for the operation. */
  stdin: unknown;
  /** Per-exec secrets, injected only for this call. */
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Forwarded log lines (e.g. runner stderr) → step logs. */
  onLog?: (line: string, meta?: Record<string, unknown>) => void;
}

export interface ExecResult {
  ok: boolean;
  structured?: unknown;
  error?: string;
}

/**
 * Executes a single operation. The `local` backend calls this in-process;
 * the Docker backend (later plan) pipes it into a container runner.
 */
export type OperationRunner = (
  op: ExecOp,
  ctx: { workspaceDir: string },
) => Promise<ExecResult>;

/** Uniform contract every worker type implements. */
export interface IExecutionEnvironment {
  readonly type: ComputeTargetType;
  /** No-op for shared/local; provisions a fresh unit + workspace for per-instance. */
  provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv>;
  exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult>;
  destroy(env: ProvisionedEnv): Promise<void>;
  list(filter?: { runId?: string; orphanedOnly?: boolean }): Promise<ProvisionedEnv[]>;
  /**
   * Replace the contents of `destDir` (inside the environment) with `bundle`.
   * Implementations clear destDir first, then extract — so callers get exactly
   * the bundled files (per-step skill staging relies on this).
   */
  materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void>;
}

/** A Worker record resolved to the fields a backend needs at run start. */
export interface ResolvedComputeTarget {
  id: string;
  type: ComputeTargetType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity;
  /** Type-specific config, validated by the backend. */
  config: unknown;
}

/** A pluggable worker *type*. Registered by name; callers never change. */
export interface ExecutionEnvironmentBackend {
  readonly type: ComputeTargetType;
  readonly supportedModes: ExecutionMode[];
  readonly supportedConnectivity: Connectivity[];
  /** Throws if the worker's config is invalid for this type. */
  validateConfig(config: unknown): void;
  create(worker: ResolvedComputeTarget): IExecutionEnvironment;
}

export interface IExecutionEnvironmentRegistry {
  register(backend: ExecutionEnvironmentBackend): void;
  /** Throws if no backend registered for the type. */
  get(type: ComputeTargetType): ExecutionEnvironmentBackend;
  /** Worker types this deployment has configured. */
  available(): ComputeTargetType[];
}
