import { randomUUID } from "node:crypto";
import type {
  CreateGrantArgs, FlowGrant, IFlowGrantsStore,
} from "@journeyman/core";

export class MemoryFlowGrantsStore implements IFlowGrantsStore {
  private rows = new Map<string, FlowGrant>();

  async create(args: CreateGrantArgs): Promise<FlowGrant> {
    const g: FlowGrant = {
      id: randomUUID(),
      flowId: args.flowId,
      principalType: args.principalType,
      principalId: args.principalId,
      role: args.role,
      createdAt: new Date(),
      createdBy: args.createdBy,
    };
    this.rows.set(g.id, g);
    return g;
  }

  async listByFlow(flowId: string): Promise<FlowGrant[]> {
    return [...this.rows.values()].filter(g => g.flowId === flowId);
  }

  async listForCaller(args: { callerUserId: string | null; callerOrgId: string | null }): Promise<FlowGrant[]> {
    return [...this.rows.values()].filter(g =>
      g.principalType === "global"
      || (g.principalType === "user" && g.principalId === args.callerUserId)
      || (g.principalType === "org"  && g.principalId === args.callerOrgId),
    );
  }

  async delete(grantId: string): Promise<void> { this.rows.delete(grantId); }

  async getOwnerGrant(flowId: string): Promise<FlowGrant | null> {
    return [...this.rows.values()].find(g => g.flowId === flowId && g.role === "owner") ?? null;
  }
}
