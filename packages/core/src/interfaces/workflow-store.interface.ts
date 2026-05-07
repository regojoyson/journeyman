import type {
  Workflow, WorkflowGrant, WorkflowGrantRole, WorkflowGraph, WorkflowScope, WorkflowStatus, WorkflowVersion,
} from "../types/flow.types.ts";

export interface CreateWorkflowArgs {
  scope: WorkflowScope;
  name: string;
  description?: string;
  /** Required when scope === "user" or "org". Null when scope === "global". */
  orgId: string | null;
  /** Required when scope === "user". Null otherwise. */
  ownerUserId: string | null;
  initialDefinition: WorkflowGraph;
  createdByUserId: string | null;
}

export interface WorkflowListFilter {
  /** Caller for visibility evaluation. */
  callerUserId: string | null;
  callerOrgId: string | null;
  callerIsPlatformAdmin: boolean;
  callerIsOrgAdmin: boolean;
  scope?: WorkflowScope;
  /** Restrict to a specific org (admin moderation view). */
  orgId?: string;
  limit?: number;
}

export interface IWorkflowStore {
  create(args: CreateWorkflowArgs): Promise<{ workflow: Workflow; version: WorkflowVersion }>;
  getById(workflowId: string): Promise<Workflow | null>;
  list(filter: WorkflowListFilter): Promise<Workflow[]>;
  /** Update name/description metadata. Does NOT touch versions or grants. */
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

export interface CreateWorkflowGrantArgs {
  workflowId: string;
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: WorkflowGrantRole;
  createdBy: string | null;
}

export interface IWorkflowGrantsStore {
  create(args: CreateWorkflowGrantArgs): Promise<WorkflowGrant>;
  listByWorkflow(workflowId: string): Promise<WorkflowGrant[]>;
  /** Returns grants that match the caller (user grants, org grants for caller's org, all global grants). */
  listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<WorkflowGrant[]>;
  delete(grantId: string): Promise<void>;
  /** Owner grant for a workflow, or null. */
  getOwnerGrant(workflowId: string): Promise<WorkflowGrant | null>;
}
