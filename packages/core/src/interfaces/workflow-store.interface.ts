import type {
  Workflow, WorkflowGraph, WorkflowStatus, WorkflowVersion,
} from "../types/flow.types.ts";

export interface CreateWorkflowArgs {
  workspaceId: string;
  name: string;
  description?: string;
  initialDefinition: WorkflowGraph;
  createdByUserId: string | null;
}

export interface WorkflowListFilter {
  workspaceId: string;
  limit?: number;
  offset?: number;
}

export interface IWorkflowStore {
  create(args: CreateWorkflowArgs): Promise<{ workflow: Workflow; version: WorkflowVersion }>;
  getById(workflowId: string): Promise<Workflow | null>;
  list(filter: WorkflowListFilter): Promise<Workflow[]>;
  count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number>;
  /** Update name/description metadata. Does NOT touch versions. */
  updateMeta(workflowId: string, patch: { name?: string; description?: string | null }): Promise<Workflow | null>;
  /** Lifecycle status flip. Returns the updated workflow, or null if not found. */
  setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null>;
  delete(workflowId: string): Promise<void>;
}

export interface IWorkflowVersionStore {
  appendVersion(args: {
    workflowId: string;
    definition: WorkflowGraph;
    createdByUserId: string | null;
  }): Promise<WorkflowVersion>;
  getById(versionId: string): Promise<WorkflowVersion | null>;
  listByWorkflow(workflowId: string): Promise<WorkflowVersion[]>;
}
