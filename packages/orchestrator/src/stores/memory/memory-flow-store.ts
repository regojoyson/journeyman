import { randomUUID } from "node:crypto";
import type {
  CreateWorkflowArgs, Workflow, WorkflowGrant, WorkflowGraph, WorkflowListFilter,
  WorkflowStatus, WorkflowVersion,
  IWorkflowGrantsStore, IWorkflowStore, IWorkflowVersionStore,
} from "@journeyman/core";

export class MemoryWorkflowVersionStore implements IWorkflowVersionStore {
  private rows = new Map<string, WorkflowVersion>();

  async appendVersion(args: {
    workflowId: string;
    definition: WorkflowGraph;
    createdByUserId: string | null;
  }): Promise<WorkflowVersion> {
    const existing = [...this.rows.values()].filter(v => v.workflowId === args.workflowId);
    const next = existing.length === 0
      ? 1
      : Math.max(...existing.map(v => v.versionNumber)) + 1;
    const v: WorkflowVersion = {
      id: randomUUID(),
      workflowId: args.workflowId,
      versionNumber: next,
      definition: args.definition,
      createdByUserId: args.createdByUserId,
      createdAt: new Date(),
    };
    this.rows.set(v.id, v);
    return v;
  }

  async getById(versionId: string): Promise<WorkflowVersion | null> {
    return this.rows.get(versionId) ?? null;
  }

  async listByWorkflow(workflowId: string): Promise<WorkflowVersion[]> {
    return [...this.rows.values()]
      .filter(v => v.workflowId === workflowId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }
}

export class MemoryWorkflowStore implements IWorkflowStore {
  private rows = new Map<string, {
    id: string; name: string; description: string | null;
    currentVersionId: string | null; createdByUserId: string | null;
    createdAt: Date; updatedAt: Date;
    status: WorkflowStatus;
  }>();

  constructor(
    private versions: MemoryWorkflowVersionStore,
    private grants: IWorkflowGrantsStore,
  ) {}

  async create(args: CreateWorkflowArgs): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const id = randomUUID();
    const now = new Date();
    this.rows.set(id, {
      id, name: args.name, description: args.description ?? null,
      currentVersionId: null, createdByUserId: args.createdByUserId,
      createdAt: now, updatedAt: now,
      status: "draft",
    });
    const version = await this.versions.appendVersion({
      workflowId: id, definition: args.initialDefinition, createdByUserId: args.createdByUserId,
    });
    const row = this.rows.get(id)!;
    row.currentVersionId = version.id;

    const principalId =
      args.scope === "user"  ? args.ownerUserId :
      args.scope === "org"   ? args.orgId       :
      null;
    await this.grants.create({
      workflowId: id, principalType: args.scope, principalId,
      role: "owner", createdBy: args.createdByUserId,
    });

    const owner = await this.grants.getOwnerGrant(id);
    return { workflow: hydrate(row, owner, args.scope === "user" ? args.orgId : null), version };
  }

  async getById(workflowId: string): Promise<Workflow | null> {
    const row = this.rows.get(workflowId);
    if (!row) return null;
    const owner = await this.grants.getOwnerGrant(workflowId);
    const workflow = hydrate(row, owner, null);
    workflow.grants = await this.grants.listByWorkflow(workflowId);
    return workflow;
  }

  async list(filter: WorkflowListFilter): Promise<Workflow[]> {
    let out = await this.filtered(filter);
    const offset = filter.offset ?? 0;
    if (offset) out = out.slice(offset);
    if (filter.limit) out = out.slice(0, filter.limit);
    return out;
  }

  async count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number> {
    return (await this.filtered(filter)).length;
  }

  private async filtered(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<Workflow[]> {
    const out: Workflow[] = [];
    for (const row of this.rows.values()) {
      const owner = await this.grants.getOwnerGrant(row.id);
      if (!owner) continue;
      let visible = filter.callerIsPlatformAdmin;
      if (!visible) {
        if (owner.principalType === "global") visible = true;
        else if (owner.principalType === "user" && owner.principalId === filter.callerUserId) visible = true;
        else if (owner.principalType === "org"  && owner.principalId === filter.callerOrgId) visible = true;
        else if (filter.callerIsOrgAdmin && owner.principalType === "user") {
          visible = false;
        }
      }
      if (!visible) continue;
      if (filter.scope && owner.principalType !== filter.scope) continue;
      out.push(hydrate(row, owner, null));
    }
    return out;
  }

  async updateMeta(workflowId: string, patch: { name?: string; description?: string | null }): Promise<Workflow | null> {
    const row = this.rows.get(workflowId);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    row.updatedAt = new Date();
    return this.getById(workflowId);
  }

  async setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null> {
    const row = this.rows.get(workflowId);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date();
    return this.getById(workflowId);
  }

  async delete(workflowId: string): Promise<void> { this.rows.delete(workflowId); }
}

function hydrate(
  row: { id: string; name: string; description: string | null; currentVersionId: string | null;
         createdByUserId: string | null; createdAt: Date; updatedAt: Date; status: WorkflowStatus; },
  owner: WorkflowGrant | null,
  orgHint: string | null,
): Workflow {
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
