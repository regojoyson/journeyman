import { randomUUID } from "node:crypto";
import type {
  CreateFlowArgs, Flow, FlowGraph, FlowVersion,
  IFlowStore, IFlowVersionStore,
} from "@journeyman/core";

export class MemoryFlowVersionStore implements IFlowVersionStore {
  private rows = new Map<string, FlowVersion>();

  async appendVersion(args: {
    flowId: string;
    definition: FlowGraph;
    createdByUserId: string | null;
  }): Promise<FlowVersion> {
    const existing = [...this.rows.values()].filter(v => v.flowId === args.flowId);
    const next = existing.length === 0
      ? 1
      : Math.max(...existing.map(v => v.versionNumber)) + 1;
    const v: FlowVersion = {
      id: randomUUID(),
      flowId: args.flowId,
      versionNumber: next,
      definition: args.definition,
      createdByUserId: args.createdByUserId,
      createdAt: new Date(),
    };
    this.rows.set(v.id, v);
    return v;
  }

  async getById(versionId: string): Promise<FlowVersion | null> {
    return this.rows.get(versionId) ?? null;
  }

  async listByFlow(flowId: string): Promise<FlowVersion[]> {
    return [...this.rows.values()]
      .filter(v => v.flowId === flowId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }
}

export class MemoryFlowStore implements IFlowStore {
  private rows = new Map<string, Flow>();

  constructor(private versions: MemoryFlowVersionStore) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const flowId = randomUUID();
    const version = await this.versions.appendVersion({
      flowId,
      definition: args.initialDefinition,
      createdByUserId: args.createdByUserId,
    });
    const now = new Date();
    const flow: Flow = {
      id: flowId,
      ownerUserId: args.ownerUserId,
      name: args.name,
      description: args.description ?? null,
      currentVersionId: version.id,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(flowId, flow);
    return { flow, version };
  }

  async getById(flowId: string): Promise<Flow | null> {
    return this.rows.get(flowId) ?? null;
  }

  async list(opts: { ownerUserId?: string | null; limit?: number } = {}): Promise<Flow[]> {
    let out = [...this.rows.values()];
    if (opts.ownerUserId !== undefined) {
      out = out.filter(f => f.ownerUserId === opts.ownerUserId);
    }
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }
}
