import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, inputCls, selectCls } from "./admin-styles.ts";

interface UserRow {
  user: { id: string; username: string; displayName: string | null; status: string };
  membership: { id: string; role: "admin" | "member"; createdAt: string };
}

export function AdminUsersPage(props: { orgId: string }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const base = `/api/orgs/${props.orgId}`;

  async function refresh() {
    setLoading(true);
    const r = await fetch(`${base}/users`, { credentials: "include" });
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      const r = await fetch(`${base}/invitations`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
      });
      if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
      const body = await r.json();
      setInfo(`Invited ${inviteUsername}. Temp password: ${body.tempPassword}`);
      setInviteUsername("");
      refresh();
    } finally { setBusy(false); }
  }

  async function setRole(userId: string, role: "admin" | "member") {
    setError(null); setInfo(null);
    const r = await fetch(`${base}/memberships/${userId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!r.ok) setError((await r.json()).error ?? "Failed");
    refresh();
  }

  async function setStatus(userId: string, status: "active" | "disabled") {
    setError(null); setInfo(null);
    const r = await fetch(`${base}/users/${userId}/status`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) setError((await r.json()).error ?? "Failed");
    else refresh();
  }

  async function reset(userId: string, username: string) {
    setError(null); setInfo(null);
    const r = await fetch(`${base}/users/${userId}/reset-password`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    const body = await r.json();
    setInfo(`Reset password for ${username}. Temp password: ${body.tempPassword}`);
  }

  async function remove(userId: string, username: string) {
    if (!confirm(`Remove ${username} from this org?`)) return;
    setError(null); setInfo(null);
    const r = await fetch(`${base}/memberships/${userId}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) setError((await r.json()).error ?? "Failed");
    else refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Users</h1>
          <p className="mt-1 text-sm text-slate-400">
            Invite and manage members of this organization. Admins can manage other users and org-level secrets.
          </p>
        </header>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-medium text-slate-100 mb-4">Invite a new user</h2>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Username</label>
              <input
                className={inputCls}
                placeholder="username"
                value={inviteUsername}
                onChange={e => setInviteUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as "admin" | "member")}
                className={selectCls}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Inviting…" : "Send invitation"}
            </button>
          </form>
          {info && (
            <div className="mt-4 rounded-md border border-accent/25 bg-accent/10 px-4 py-2 text-sm text-foreground">
              {info}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-md border border-danger/25 bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-100">
              Members <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No members yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Username</th>
                  <th className="text-left font-medium px-6 py-3">Display name</th>
                  <th className="text-left font-medium px-6 py-3">Role</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {rows.map(r => {
                  const isDisabled = r.user.status === "disabled";
                  return (
                    <tr key={r.user.id} className="hover:bg-surface-hover">
                      <td className="px-6 py-3 text-slate-100 font-medium">{r.user.username}</td>
                      <td className="px-6 py-3 text-slate-300">
                        {r.user.displayName ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={r.membership.role}
                          onChange={e => setRole(r.user.id, e.target.value as "admin" | "member")}
                          className={selectCls}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium " +
                            (isDisabled
                              ? "bg-danger/10 text-danger border border-danger/25"
                              : "bg-success/10 text-success border border-success/25")
                          }
                        >
                          <span className={"h-1.5 w-1.5 rounded-full " + (isDisabled ? "bg-rose-400" : "bg-emerald-400")} />
                          {r.user.status}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex justify-end gap-2 flex-wrap">
                          {isDisabled ? (
                            <button onClick={() => setStatus(r.user.id, "active")} className={btnGhost}>Enable</button>
                          ) : (
                            <button onClick={() => setStatus(r.user.id, "disabled")} className={btnGhost}>Disable</button>
                          )}
                          <button onClick={() => reset(r.user.id, r.user.username)} className={btnGhost}>Reset password</button>
                          <button onClick={() => remove(r.user.id, r.user.username)} className={btnDanger}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
