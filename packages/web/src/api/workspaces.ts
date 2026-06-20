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
};
