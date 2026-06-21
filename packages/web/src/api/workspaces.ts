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
export interface WorkspaceDetail { id: string; orgId: string; name: string; slug: string; createdAt: string; }

export interface WorkspaceMember {
  userId: string;
  username: string;
  displayName: string | null;
  role: WorkspaceRole;
  createdAt: string;
}
export interface AddableMember {
  userId: string;
  username: string;
  displayName: string | null;
}
export interface WorkspaceMembersPage {
  items: WorkspaceMember[];
  total: number;
  page: number;
  limit: number;
}

export const workspaceAdminApi = {
  listForOrg: (orgId: string) =>
    api<{ workspaces: OrgWorkspace[] }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`).then((r) => r.workspaces),
  create: (orgId: string, body: { name: string; slug?: string }) =>
    api<OrgWorkspace>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces`, { method: "POST", body: JSON.stringify(body) }),
  remove: (orgId: string, wsId: string) =>
    api<{ ok: true }>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, { method: "DELETE" }),
  getOne: (orgId: string, wsId: string) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`),
  update: (orgId: string, wsId: string, body: { name: string; slug?: string }) =>
    api<WorkspaceDetail>(`/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listMembers: (orgId: string, wsId: string, opts: { page: number; limit: number }) =>
    api<WorkspaceMembersPage>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members` +
        `?page=${opts.page}&limit=${opts.limit}`,
    ),
  listAddableMembers: (orgId: string, wsId: string, q: string) =>
    api<{ items: AddableMember[] }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/addable-members` +
        `?q=${encodeURIComponent(q)}`,
    ).then((r) => r.items),
  addMember: (orgId: string, wsId: string, body: { userId: string; role: WorkspaceRole }) =>
    api<{ userId: string; role: WorkspaceRole }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  setMemberRole: (orgId: string, wsId: string, userId: string, role: WorkspaceRole) =>
    api<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  removeMember: (orgId: string, wsId: string, userId: string) =>
    api<{ ok: true }>(
      `/api/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
};
