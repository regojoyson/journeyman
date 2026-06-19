import type { SandboxType, ExecutionMode, Connectivity } from "./execution-environment.types.ts";

export type SandboxScope = "org" | "system";

export type ImageState = "none" | "pending" | "building" | "ready" | "failed";

/** A Sandbox row as stored in jm_sandboxes. */
export interface Sandbox {
  id: string;
  scope: SandboxScope;
  /** Set for org scope; null for system. */
  orgId: string | null;
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  tags: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Managed-image build lifecycle (docker sandboxes). 'none' = use the default box. */
  imageState: ImageState;
  imageFingerprint: string | null;
  imageRef: string | null;
  imageError: string | null;
  imageBuiltAt: Date | null;
}

export interface CreateSandboxArgs {
  scope: SandboxScope;
  orgId: string | null;
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateSandboxArgs {
  id: string;
  orgId: string | null;
  name?: string;
  executionMode?: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
}
