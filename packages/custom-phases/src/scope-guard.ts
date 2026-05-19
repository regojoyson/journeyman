export type ResourceScope = "user" | "org" | "global";
export type PhaseScope = "user" | "org";

const SCOPE_RANK: Record<ResourceScope, number> = { user: 0, org: 1, global: 2 };

export interface ScopeLookup {
  skill: (id: string) => Promise<{ scope: ResourceScope } | null>;
  mcp:   (id: string) => Promise<{ scope: ResourceScope } | null>;
}

export interface ScopeOffender {
  kind: "skill" | "mcp";
  id: string;
  scope: ResourceScope | "unknown";
}

export class ScopeViolationError extends Error {
  readonly offenders: ScopeOffender[];
  constructor(offenders: ScopeOffender[]) {
    super(`Scope violation: ${offenders.map(o => `${o.kind}:${o.id} (${o.scope})`).join(", ")}`);
    this.name = "ScopeViolationError";
    this.offenders = offenders;
  }
}

export async function assertScopeSafeDefaults(args: {
  phaseScope: PhaseScope;
  defaultSkillIds: string[];
  defaultMcpIds: string[];
  lookup: ScopeLookup;
}): Promise<void> {
  const minRank = SCOPE_RANK[args.phaseScope];
  const offenders: ScopeOffender[] = [];

  for (const id of args.defaultSkillIds) {
    const rec = await args.lookup.skill(id);
    if (!rec) { offenders.push({ kind: "skill", id, scope: "unknown" }); continue; }
    if (SCOPE_RANK[rec.scope] < minRank) offenders.push({ kind: "skill", id, scope: rec.scope });
  }
  for (const id of args.defaultMcpIds) {
    const rec = await args.lookup.mcp(id);
    if (!rec) { offenders.push({ kind: "mcp", id, scope: "unknown" }); continue; }
    if (SCOPE_RANK[rec.scope] < minRank) offenders.push({ kind: "mcp", id, scope: rec.scope });
  }

  if (offenders.length > 0) throw new ScopeViolationError(offenders);
}
