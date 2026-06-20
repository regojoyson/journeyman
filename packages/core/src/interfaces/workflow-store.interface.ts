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
  /** Creates a workflow with its draft seeded from initialDefinition. No version row, not published. */
  create(args: CreateWorkflowArgs): Promise<Workflow>;
  getById(workflowId: string): Promise<Workflow | null>;
  list(filter: WorkflowListFilter): Promise<Workflow[]>;
  count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number>;
  /** Update name/description metadata. Does NOT touch the draft or versions. */
  updateMeta(workflowId: string, patch: { name?: string; description?: string | null }): Promise<Workflow | null>;
  /** Overwrite the mutable draft in place. Returns the updated workflow, or null if not found. */
  updateDraft(workflowId: string, args: { definition: WorkflowGraph; updatedByUserId: string | null }): Promise<Workflow | null>;
  /** Freeze the current draft into a new immutable version, set it published, status=ready. */
  promote(workflowId: string, args: { createdByUserId: string | null }): Promise<{ workflow: Workflow; version: WorkflowVersion } | null>;
  /** Point published at an existing version of this workflow, status=ready. Does NOT touch the draft. */
  rollback(workflowId: string, args: { versionId: string }): Promise<Workflow | null>;
  /** Lifecycle status flip to draft + clear published pointer. Returns the updated workflow, or null if not found. */
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
