import { randomUUID } from "node:crypto";
import type {
  CreateFlowArgs, Flow, FlowGrant, FlowGraph, FlowListFilter, FlowStatus, FlowVersion,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore,
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
  private rows = new Map<string, {
    id: string; name: string; description: string | null;
    currentVersionId: string | null; createdByUserId: string | null;
    createdAt: Date; updatedAt: Date;
    status: FlowStatus;
  }>();

  constructor(
    private versions: MemoryFlowVersionStore,
    private grants: IFlowGrantsStore,
  ) {}

  async create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }> {
    const id = randomUUID();
    const now = new Date();
    this.rows.set(id, {
      id, name: args.name, description: args.description ?? null,
      currentVersionId: null, createdByUserId: args.createdByUserId,
      createdAt: now, updatedAt: now,
      status: "draft",
    });
    const version = await this.versions.appendVersion({
      flowId: id, definition: args.initialDefinition, createdByUserId: args.createdByUserId,
    });
    const row = this.rows.get(id)!;
    row.currentVersionId = version.id;

    const principalId =
      args.scope === "user"  ? args.ownerUserId :
      args.scope === "org"   ? args.orgId       :
      null;
    await this.grants.create({
      flowId: id, principalType: args.scope, principalId,
      role: "owner", createdBy: args.createdByUserId,
    });

    const owner = await this.grants.getOwnerGrant(id);
    return { flow: hydrate(row, owner, args.scope === "user" ? args.orgId : null), version };
  }

  async getById(flowId: string): Promise<Flow | null> {
    const row = this.rows.get(flowId);
    if (!row) return null;
    const owner = await this.grants.getOwnerGrant(flowId);
    const flow = hydrate(row, owner, null);
    flow.grants = await this.grants.listByFlow(flowId);
    return flow;
  }

  async list(filter: FlowListFilter): Promise<Flow[]> {
    const out: Flow[] = [];
    for (const row of this.rows.values()) {
      const owner = await this.grants.getOwnerGrant(row.id);
      if (!owner) continue;
      // Visibility check.
      let visible = filter.callerIsPlatformAdmin;
      if (!visible) {
        if (owner.principalType === "global") visible = true;
        else if (owner.principalType === "user" && owner.principalId === filter.callerUserId) visible = true;
        else if (owner.principalType === "org"  && owner.principalId === filter.callerOrgId) visible = true;
        else if (filter.callerIsOrgAdmin && owner.principalType === "user") {
          // Approximate: not enforcing membership lookup in memory store. Allow if same orgId hint matches.
          visible = false;
        }
      }
      if (!visible) continue;
      if (filter.scope && owner.principalType !== filter.scope) continue;
      out.push(hydrate(row, owner, null));
    }
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  async updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null> {
    const row = this.rows.get(flowId);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    row.updatedAt = new Date();
    return this.getById(flowId);
  }

  async setStatus(flowId: string, status: FlowStatus): Promise<Flow | null> {
    const row = this.rows.get(flowId);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date();
    return this.getById(flowId);
  }

  async delete(flowId: string): Promise<void> { this.rows.delete(flowId); }
}

function hydrate(
  row: { id: string; name: string; description: string | null; currentVersionId: string | null;
         createdByUserId: string | null; createdAt: Date; updatedAt: Date; status: FlowStatus; },
  owner: FlowGrant | null,
  orgHint: string | null,
): Flow {
  const base = {
    id: row.id, name: row.name, description: row.description,
    currentVersionId: row.currentVersionId, createdByUserId: row.createdByUserId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    status: row.status,
  };
  if (!owner) return { ...base, scope: "user", orgId: null, ownerUserId: null };
  if (owner.principalType === "global") return { ...base, scope: "global", orgId: null, ownerUserId: null };
  if (owner.principalType === "org")    return { ...base, scope: "org", orgId: owner.principalId, ownerUserId: null };
  return { ...base, scope: "user", orgId: orgHint, ownerUserId: owner.principalId };
}
