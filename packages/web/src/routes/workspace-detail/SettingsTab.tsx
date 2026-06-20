import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ApiError } from "../../api/client.ts";
import { workspaceAdminApi } from "../../api/workspaces.ts";
import { btnDangerOutline, btnDangerSolid, btnGhost, btnPrimary, card, codePill, inputCls } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function SettingsTab() {
  const { orgId, wsId, workspace, refresh } = useOutletContext<WorkspaceDetailContext>();
  const navigate = useNavigate();
  const isDefault = workspace.slug === "default";

  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await workspaceAdminApi.update(orgId, wsId, { name, slug: slug.trim() || undefined });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("A workspace with that slug already exists.");
      else setError(err instanceof Error ? err.message : "Failed to save workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.remove(orgId, wsId);
      navigate(`/orgs/${orgId}/workspaces`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("The default workspace can't be deleted.");
      else setError(err instanceof Error ? err.message : "Failed to delete workspace.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className={`${card} p-6`}>
        <h2 className="text-base font-medium text-slate-100 mb-4">Settings</h2>
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Slug</label>
            <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
        </form>
        {error && !confirming && <div className="mt-4 text-sm text-destructive">{error}</div>}
      </section>

      <section className={`${card} p-0 overflow-hidden border-destructive/50`}>
        {!confirming ? (
          <div className="flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-sm font-medium text-destructive">Delete this workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Permanently removes all flows, agents, secrets, connections, MCPs, skills, custom steps,
                and webhooks. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => { setConfirming(true); setConfirmName(""); setError(null); }}
              disabled={isDefault}
              title={isDefault ? "The default workspace can't be deleted." : undefined}
              className={`shrink-0 ${btnDangerOutline}${isDefault ? " opacity-50 cursor-not-allowed" : ""}`}
            >
              Delete workspace
            </button>
          </div>
        ) : (
          <div className="p-6">
            <h2 className="text-sm font-medium text-destructive mb-1">Delete this workspace</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Type <span className={codePill}>{workspace.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={workspace.name}
              autoFocus
            />
            {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={busy} className={btnGhost}>Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={busy || confirmName !== workspace.name}
                className={`${btnDangerSolid}${busy || confirmName !== workspace.name ? " opacity-50 cursor-not-allowed" : ""}`}
              >
                {busy ? "Deleting…" : "Delete workspace"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
