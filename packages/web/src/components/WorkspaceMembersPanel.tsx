import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@journeyman/core";
import { workspaceAdminApi, type WorkspaceMember } from "../api/workspaces.ts";
import { AddMemberDialog } from "./AddMemberDialog.tsx";
import { btnDanger, btnPrimary, card, selectCls } from "../routes/admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

export function WorkspaceMembersPanel({ orgId, wsId }: { orgId: string; wsId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await workspaceAdminApi.listMembers(wsId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h2 className="text-base font-medium text-foreground">
          Members <span className="text-muted-foreground font-normal">({members.length})</span>
        </h2>
        <button onClick={() => setAddOpen(true)} className={btnPrimary}>+ Add member</button>
      </div>

      {error && <div className="px-6 py-3 text-sm text-destructive border-b">{error}</div>}

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : members.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">No members yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-6 py-3">Username</th>
              <th className="text-left font-medium px-6 py-3">Role</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="border-t">
            {members.map((m) => (
              <tr key={m.userId} className="border-b last:border-b-0 hover:bg-accent/40">
                <td className="px-6 py-3">
                  <div className="text-foreground font-medium">{m.username}</div>
                  {m.displayName && <div className="text-xs text-muted-foreground">{m.displayName}</div>}
                </td>
                <td className="px-6 py-3">
                  <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value as WorkspaceRole)} className={selectCls}>
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

      {addOpen && (
        <AddMemberDialog
          orgId={orgId}
          wsId={wsId}
          existingMemberIds={members.map((m) => m.userId)}
          onAdded={refresh}
          onClose={() => setAddOpen(false)}
        />
      )}
    </section>
  );
}
