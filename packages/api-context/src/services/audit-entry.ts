import type { AuditEntryInput } from "./audit.ts";

export interface AuditTag {
  action: string;
  targetType: string;
  idParam?: string;
}

export interface BuildAuditEntryArgs {
  statusCode: number;
  tag: AuditTag | undefined;
  runContext:
    | { user: { id: string }; org: { id: string }; workspace?: { orgId: string } }
    | undefined;
  params: Record<string, unknown>;
  explicitTargetId?: string | null;
  detail?: Record<string, unknown>;
}

/** Pure: derive the audit row from request facts, or null when nothing should be logged. */
export function buildAuditEntry(a: BuildAuditEntryArgs): AuditEntryInput | null {
  if (a.statusCode < 200 || a.statusCode >= 300) return null;
  if (!a.tag) return null;
  if (!a.runContext) return null;

  const orgId = a.runContext.workspace?.orgId ?? a.runContext.org.id;
  const paramKey = a.tag.idParam ?? "id";
  const fromParams = a.params[paramKey];
  const targetId =
    a.explicitTargetId != null
      ? a.explicitTargetId
      : typeof fromParams === "string"
        ? fromParams
        : null;

  return {
    orgId,
    actorUserId: a.runContext.user.id,
    action: a.tag.action,
    targetType: a.tag.targetType,
    targetId,
    detail: a.detail ?? {},
  };
}
