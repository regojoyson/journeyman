// packages/flow-editor/src/api/connections.ts
import type { Connection, ConnectionCategory } from "@journeyman/core";

export async function fetchConnections(
  wsId: string,
  category: ConnectionCategory,
): Promise<Connection[]> {
  try {
    const r = await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/connections?category=${category}`,
      { credentials: "include" },
    );
    if (!r.ok) return [];
    const data = await r.json() as Connection[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export interface RepoSummary {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export async function fetchConnectionRepos(
  wsId: string,
  connectionId: string,
  search?: string,
): Promise<RepoSummary[]> {
  try {
    const qs = search ? `?search=${encodeURIComponent(search)}` : "";
    const r = await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/connections/${encodeURIComponent(connectionId)}/repos${qs}`,
      { credentials: "include" },
    );
    if (!r.ok) return [];
    const data = await r.json() as { repos?: RepoSummary[] };
    return Array.isArray(data?.repos) ? data.repos! : [];
  } catch {
    return [];
  }
}
