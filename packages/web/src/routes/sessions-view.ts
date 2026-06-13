import type { BuilderSession } from "../api/builder.ts";

/** Display label: session name, else the first user prompt (truncated), else a default. */
export function sessionLabel(session: BuilderSession): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstUser = session.messages.find((m) => m.role === "user")?.content?.trim();
  if (firstUser) return firstUser.length > 60 ? `${firstUser.slice(0, 57)}…` : firstUser;
  return "Untitled build";
}

/** Short human badge for a session's status. */
export function sessionStatusBadge(session: BuilderSession): string {
  switch (session.status) {
    case "applied":  return "applied";
    case "archived": return "archived";
    default:         return "draft";
  }
}

/** Active drafts first, then applied, then archived. Stable within each group. */
export function orderSessions(sessions: BuilderSession[]): BuilderSession[] {
  const rank: Record<BuilderSession["status"], number> = { active: 0, applied: 1, archived: 2 };
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank[a.s.status] - rank[b.s.status] || a.i - b.i)
    .map((x) => x.s);
}
