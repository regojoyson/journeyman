import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { WorkspaceRole } from "@journeyman/core";
import { useWorkspace } from "../WorkspaceContext.tsx";
import {
  workspaceAdminApi,
  listOrgUsers,
  type WorkspaceMember,
  type OrgUser,
} from "../api/workspaces.ts";
import { btnDanger, btnPrimary, card, selectCls } from "./admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

export function WorkspaceMembersPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { can, activeWorkspace } = useWorkspace();
  const orgId = activeWorkspace?.orgId ?? "";
  const allowed = can("members.manage");

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<WorkspaceRole>("contributor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const m = await workspaceAdminApi.listMembers(wsId);
      setMembers(m);
      if (orgId) setOrgUsers(await listOrgUsers(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [allowed, wsId, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!allowed) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full px-6 py-10">
          <div className={`${card} p-6 text-sm text-slate-300`}>
            You don't have permission to manage members of this workspace.
          </div>
        </div>
      </div>
    );
  }

  const memberIds = new Set(members.map((m) => m.userId));
  const addable = orgUsers.filter((u) => !memberIds.has(u.id));

  async function setRole(userId: string, role: WorkspaceRole) {
    setError(null);
    try {
      await workspaceAdminApi.setMemberRole(wsId, userId, role);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    }
  }

  async function remove(userId: string, username: string) {
    if (!confirm(`Remove ${username} from this workspace?`)) return;
    setError(null);
    try {
      await workspaceAdminApi.removeMember(wsId, userId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!addUserId) return;
    setError(null);
    setBusy(true);
    try {
      await workspaceAdminApi.addMember(wsId, { userId: addUserId, role: addRole });
      setAddUserId("");
      setAddRole("contributor");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Members</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage who can access this workspace and what they can do.
          </p>
        </header>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-medium text-slate-100 mb-4">Add a member</h2>
          {addable.length === 0 ? (
            <p className="text-sm text-slate-500">All org users are already members.</p>
          ) : (
            <form onSubmit={add} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">User</label>
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  className={selectCls}
                  required
                >
                  <option value="">Select a user…</option>
                  {addable.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}{u.displayName ? ` (${u.displayName})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Role</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as WorkspaceRole)}
                  className={selectCls}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button type="submit" disabled={busy || !addUserId} className={btnPrimary}>
                {busy ? "Adding…" : "Add member"}
              </button>
            </form>
          )}
          {error && (
            <div className="mt-4 text-sm text-destructive">{error}</div>
          )}
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-base font-medium text-slate-100">
              Members <span className="text-slate-500 font-normal">({members.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : members.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No members yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Username</th>
                  <th className="text-left font-medium px-6 py-3">Role</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {members.map((m) => (
                  <tr key={m.userId} className="hover:bg-surface-hover">
                    <td className="px-6 py-3">
                      <div className="text-slate-100 font-medium">{m.username}</div>
                      {m.displayName && (
                        <div className="text-xs text-slate-500">{m.displayName}</div>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <select
                        value={m.role}
                        onChange={(e) => setRole(m.userId, e.target.value as WorkspaceRole)}
                        className={selectCls}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end">
                        <button onClick={() => remove(m.userId, m.username)} className={btnDanger}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
