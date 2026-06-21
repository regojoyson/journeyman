import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { WorkspaceRole } from "@journeyman/core";
import {
  workspaceAdminApi,
  type AddableMember,
  type WorkspaceMember,
} from "../../api/workspaces.ts";
import { btnDanger, btnGhost, btnPrimary, card, inputCls, selectCls } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];
const LIMIT = 20;

function initials(m: { username: string; displayName: string | null }): string {
  const base = m.displayName || m.username;
  return base.slice(0, 2).toUpperCase();
}

export function MembersTab() {
  const { orgId, wsId } = useOutletContext<WorkspaceDetailContext>();

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<AddableMember[]>([]);
  const [selected, setSelected] = useState<AddableMember | null>(null);
  const [addRole, setAddRole] = useState<WorkspaceRole>("contributor");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p: number) => {
    setError(null);
    try {
      const res = await workspaceAdminApi.listMembers(orgId, wsId, { page: p, limit: LIMIT });
      setMembers(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    }
  }, [orgId, wsId]);

  useEffect(() => { void load(1); }, [load]);

  // Debounced addable-members search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        setCandidates(await workspaceAdminApi.listAddableMembers(orgId, wsId, query));
      } catch {
        setCandidates([]);
      }
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, orgId, wsId, members]);

  async function add() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.addMember(orgId, wsId, { userId: selected.userId, role: addRole });
      setSelected(null);
      setQuery("");
      await load(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: WorkspaceRole) {
    setError(null);
    try {
      await workspaceAdminApi.setMemberRole(orgId, wsId, userId, role);
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
      await load(page);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.removeMember(orgId, wsId, userId);
      setConfirmRemove(null);
      const lastOnPage = members.length === 1 && page > 1;
      await load(lastOnPage ? page - 1 : page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    } finally {
      setBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-8">
      <section className={`${card} p-6`}>
        <h2 className="text-base font-medium text-slate-100 mb-4">Associate a user</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">User</label>
            <input
              className={inputCls}
              value={selected ? (selected.displayName || selected.username) : query}
              placeholder="Search org members…"
              onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            />
            {!selected && query && candidates.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border bg-card shadow-card">
                {candidates.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() => { setSelected(c); setQuery(""); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">{initials(c)}</span>
                    <span>
                      <span className="block text-slate-100">{c.username}</span>
                      {c.displayName && <span className="block text-xs text-muted-foreground">{c.displayName}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!selected && query && candidates.length === 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground shadow-card">
                No matching org members.
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Role</label>
            <select className={selectCls} value={addRole} onChange={(e) => setAddRole(e.target.value as WorkspaceRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="button" onClick={add} disabled={!selected || busy} className={btnPrimary}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      <section className={`${card} p-0 overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-base font-medium text-slate-100">Members <span className="text-slate-500 font-normal">· {total}</span></h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t text-left text-muted-foreground">
              <th className="px-6 py-2 font-medium">User</th>
              <th className="px-6 py-2 font-medium">Workspace role</th>
              <th className="px-6 py-2 font-medium">Added</th>
              <th className="px-6 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">{initials(m)}</span>
                    <span>
                      <span className="block text-slate-100">{m.username}</span>
                      {m.displayName && <span className="block text-xs text-muted-foreground">{m.displayName}</span>}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-3">
                  <select
                    className={selectCls}
                    value={m.role}
                    onChange={(e) => changeRole(m.userId, e.target.value as WorkspaceRole)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-6 py-3 text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</td>
                <td className="px-6 py-3 text-right">
                  {confirmRemove === m.userId ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Remove?</span>
                      <button onClick={() => remove(m.userId)} disabled={busy} className={btnDanger}>Confirm</button>
                      <button onClick={() => setConfirmRemove(null)} className={btnGhost}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmRemove(m.userId)} className={btnDanger}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr className="border-t"><td colSpan={4} className="px-6 py-6 text-center text-muted-foreground">No members yet.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <span className="text-sm text-muted-foreground">
            {total === 0 ? "No members" : `Showing ${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, total)} of ${total}`}
          </span>
          <span className="flex items-center gap-2">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className={btnGhost}>Prev</button>
            <span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span>
            <button onClick={() => load(page + 1)} disabled={page >= pageCount} className={btnGhost}>Next</button>
          </span>
        </div>
      </section>

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
