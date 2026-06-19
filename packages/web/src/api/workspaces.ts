import { api } from "./client.ts";
import type { WorkspacePermission, WorkspaceRole } from "@journeyman/core";

export interface WorkspaceSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  permissions: WorkspacePermission[];
}

export function listMyWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
}

export interface OrgWorkspace { id: string; orgId: string; name: string; slug: string; }
export interface WorkspaceMember { userId: string; username: string; displayName: string | null; role: WorkspaceRole; createdAt: string; }

export const workspaceAdminApi = {
  listForOrg: (orgId: string) =>
    api<{ workspaces: OrgWorkspace[] }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`).then((r) => r.workspaces),
  create: (orgId: string, body: { name: string; slug?: string }) =>
    api<OrgWorkspace>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`, { method: "POST", body: JSON.stringify(body) }),
  remove: (orgId: string, wsId: string) =>
    api<{ ok: true }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, { method: "DELETE" }),
  listMembers: (wsId: string) =>
    api<{ members: WorkspaceMember[] }>(`/api/workspaces/${encodeURIComponent(wsId)}/members`).then((r) => r.members),
  addMember: (wsId: string, body: { userId: string; role: WorkspaceRole }) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members`, { method: "POST", body: JSON.stringify(body) }),
  setMemberRole: (wsId: string, userId: string, role: WorkspaceRole) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (wsId: string, userId: string) =>
    api(`/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
};

// Org users for the member picker (reuses the org users admin endpoint).
export interface OrgUser { id: string; username: string; displayName: string | null; status: string; }
export function listOrgUsers(orgId: string): Promise<OrgUser[]> {
  return api<Array<{ user: OrgUser }>>(`/api/orgs/${encodeURIComponent(orgId)}/users`).then((rows) => rows.map((r) => r.user));
}
