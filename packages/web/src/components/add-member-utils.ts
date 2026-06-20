import type { OrgUser } from "../api/workspaces.ts";

export function filterAddableUsers(
  users: OrgUser[],
  excludedIds: Set<string>,
  query: string,
): OrgUser[] {
  const q = query.trim().toLowerCase();
  return users.filter((u) => {
    if (excludedIds.has(u.id)) return false;
    if (!q) return true;
    return `${u.username} ${u.displayName ?? ""}`.toLowerCase().includes(q);
  });
}
