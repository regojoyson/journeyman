import type { Flow, FlowGraph, FlowVersion } from "../types/flow.types.ts";

export interface CreateFlowArgs {
  name: string;
  description?: string;
  ownerUserId: string | null;
  initialDefinition: FlowGraph;
  createdByUserId: string | null;
}

export interface IFlowStore {
  create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }>;
  getById(flowId: string): Promise<Flow | null>;
  list(opts?: { ownerUserId?: string | null; limit?: number }): Promise<Flow[]>;
}

export interface IFlowVersionStore {
  /** Append a new version; returns it with version_number = previous + 1. */
  appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion>;
  getById(versionId: string): Promise<FlowVersion | null>;
  listByFlow(flowId: string): Promise<FlowVersion[]>;
}
