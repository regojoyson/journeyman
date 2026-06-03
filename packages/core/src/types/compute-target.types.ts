import type { WorkerType, ExecutionMode, Connectivity } from "./execution-environment.types.ts";

export type ComputeTargetScope = "user" | "org" | "system";

/** A Worker row as stored in jm_workers. */
export interface ComputeTarget {
  id: string;
  scope: ComputeTargetScope;
  /** Set for org/user scope; null for system. */
  orgId: string | null;
  /** Set for user scope; null for org/system. */
  userId: string | null;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  tags: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateComputeTargetArgs {
  scope: ComputeTargetScope;
  orgId: string | null;
  userId: string | null;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateComputeTargetArgs {
  id: string;
  orgId: string | null;
  userId: string | null;
  name?: string;
  executionMode?: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
}
