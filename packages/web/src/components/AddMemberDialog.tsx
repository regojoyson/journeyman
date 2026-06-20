import { useEffect, useState } from "react";
import type { WorkspaceRole } from "@journeyman/core";
import { listOrgUsers, workspaceAdminApi, type OrgUser } from "../api/workspaces.ts";
import { filterAddableUsers } from "./add-member-utils.ts";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../routes/admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

function initials(u: OrgUser): string {
  const s = (u.displayName || u.username).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AddMemberDialog({
  orgId,
  wsId,
  existingMemberIds,
  onAdded,
  onClose,
}: {
  orgId: string;
  wsId: string;
  existingMemberIds: string[];
  onAdded: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("contributor");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listOrgUsers(orgId)
      .then((u) => { if (active) setOrgUsers(u); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load users."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orgId]);

  const excluded = new Set<string>([...existingMemberIds, ...addedIds]);
  const addable = filterAddableUsers(orgUsers, excluded, query);

  async function add() {
    if (!selectedUserId) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.addMember(wsId, { userId: selectedUserId, role });
      setAddedIds((prev) => [...prev, selectedUserId]);
      setSelectedUserId("");
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div className={`${card} w-full max-w-md p-0 overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-base font-medium text-foreground">Add member</h3>
          <button onClick={onClose} className={btnGhost} aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <input
            className={inputCls}
            placeholder="Search org users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />

          <div className="border rounded-md max-h-52 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : error && orgUsers.length === 0 ? (
              <div className="p-6 text-center text-sm text-destructive">{error}</div>
            ) : addable.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {orgUsers.length === 0
                  ? "No org users found."
                  : query.trim()
                    ? "No users match."
                    : "All org users are already members."}
              </div>
            ) : (
              addable.map((u) => {
                const selected = u.id === selectedUserId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUserId(u.id)}
                    className={
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition " +
                      (selected ? "bg-accent" : "hover:bg-accent/50")
                    }
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      {initials(u)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">{u.username}</span>
                      {u.displayName && (
                        <span className="block text-xs text-muted-foreground truncate">{u.displayName}</span>
                      )}
                    </span>
                    {selected && <span className="text-primary" aria-hidden>✓</span>}
                  </button>
                );
              })
            )}
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} className={`${selectCls} w-full`}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {error && orgUsers.length > 0 && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <button onClick={onClose} disabled={busy} className={btnGhost}>Cancel</button>
          <button onClick={add} disabled={busy || !selectedUserId} className={btnPrimary}>
            {busy ? "Adding…" : "Add to workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
