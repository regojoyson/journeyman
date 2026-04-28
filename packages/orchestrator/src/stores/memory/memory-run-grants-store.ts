import { randomUUID } from "node:crypto";
import {
  effectiveRole,
  type ActorContext, type CreateRunGrantArgs, type IRunGrantsStore,
  type RunGrant, type RunGrantRole,
} from "@journeyman/core";

export class MemoryRunGrantsStore implements IRunGrantsStore {
  private rows = new Map<string, RunGrant>();

  async createForRun(
    runId: string,
    grants: Omit<CreateRunGrantArgs, "runId">[],
  ): Promise<RunGrant[]> {
    const out: RunGrant[] = [];
    for (const g of grants) {
      const row: RunGrant = {
        id: randomUUID(),
        runId,
        principalType: g.principalType,
        principalId: g.principalId,
        role: g.role,
        createdAt: new Date(),
        createdBy: g.createdBy,
      };
      this.rows.set(row.id, row);
      out.push(row);
    }
    return out;
  }

  async listByRun(runId: string): Promise<RunGrant[]> {
    return [...this.rows.values()].filter(g => g.runId === runId);
  }

  async matchForActor(
    actor: ActorContext,
    runIds: string[],
  ): Promise<Map<string, RunGrantRole>> {
    const wanted = new Set(runIds);
    const byRun = new Map<string, RunGrant[]>();
    for (const g of this.rows.values()) {
      if (!wanted.has(g.runId)) continue;
      const arr = byRun.get(g.runId) ?? [];
      arr.push(g);
      byRun.set(g.runId, arr);
    }
    const out = new Map<string, RunGrantRole>();
    for (const id of runIds) {
      const role = effectiveRole(actor, byRun.get(id) ?? []);
      if (role) out.set(id, role);
      else if (actor.isPlatformAdmin) out.set(id, "owner");
    }
    return out;
  }
}
