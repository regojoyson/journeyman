import type {
  Flow, FlowGrant, FlowGrantRole, FlowGraph, FlowScope, FlowStatus, FlowVersion,
} from "../types/flow.types.ts";

export interface CreateFlowArgs {
  scope: FlowScope;
  name: string;
  description?: string;
  /** Required when scope === "user" or "org". Null when scope === "global". */
  orgId: string | null;
  /** Required when scope === "user". Null otherwise. */
  ownerUserId: string | null;
  initialDefinition: FlowGraph;
  createdByUserId: string | null;
}

export interface FlowListFilter {
  /** Caller for visibility evaluation. */
  callerUserId: string | null;
  callerOrgId: string | null;
  callerIsPlatformAdmin: boolean;
  callerIsOrgAdmin: boolean;     // for callerOrgId
  scope?: FlowScope;
  /** Restrict to a specific org (admin moderation view). */
  orgId?: string;
  limit?: number;
}

export interface IFlowStore {
  create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }>;
  getById(flowId: string): Promise<Flow | null>;
  list(filter: FlowListFilter): Promise<Flow[]>;
  /** Update name/description metadata. Does NOT touch versions or grants. */
  updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null>;
  /** Lifecycle status flip. Returns the updated flow, or null if not found. */
  setStatus(flowId: string, status: FlowStatus): Promise<Flow | null>;
  delete(flowId: string): Promise<void>;
}

export interface IFlowVersionStore {
  appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion>;
  getById(versionId: string): Promise<FlowVersion | null>;
  listByFlow(flowId: string): Promise<FlowVersion[]>;
}

export interface CreateGrantArgs {
  flowId: string;
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: FlowGrantRole;
  createdBy: string | null;
}

export interface IFlowGrantsStore {
  create(args: CreateGrantArgs): Promise<FlowGrant>;
  listByFlow(flowId: string): Promise<FlowGrant[]>;
  /** Returns grants that match the caller (user grants, org grants for caller's org, all global grants). */
  listForCaller(args: {
    callerUserId: string | null;
    callerOrgId: string | null;
  }): Promise<FlowGrant[]>;
  delete(grantId: string): Promise<void>;
  /** Owner grant for a flow, or null. */
  getOwnerGrant(flowId: string): Promise<FlowGrant | null>;
}
