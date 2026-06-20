import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { workspaceAdminApi, type OrgWorkspace } from "../api/workspaces.ts";
import { btnPrimary, card, codePill, inputCls } from "./admin-styles.ts";

export function OrgWorkspacesPage() {
  const { orgId = "" } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<OrgWorkspace[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspaces(await workspaceAdminApi.listForOrg(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspaces.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await workspaceAdminApi.create(orgId, { name, slug: slug.trim() || undefined });
      setName("");
      setSlug("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("A workspace with that slug already exists.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to create workspace.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create and manage the workspaces in this organization.
          </p>
        </header>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-medium text-slate-100 mb-4">New workspace</h2>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Name</label>
              <input
                className={inputCls}
                placeholder="My Workspace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Slug (optional)</label>
              <input
                className={inputCls}
                placeholder="my-workspace"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Creating…" : "Create"}
            </button>
          </form>
          {error && (
            <div className="mt-4 text-sm text-destructive">{error}</div>
          )}
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-base font-medium text-slate-100">
              Workspaces <span className="text-slate-500 font-normal">({workspaces.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : workspaces.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No workspaces yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Slug</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {workspaces.map((ws) => (
                  <tr
                    key={ws.id}
                    onClick={() => navigate(`/orgs/${orgId}/workspaces/${ws.id}`)}
                    className="hover:bg-surface-hover cursor-pointer"
                  >
                    <td className="px-6 py-3 text-slate-100 font-medium">{ws.name}</td>
                    <td className="px-6 py-3"><span className={codePill}>{ws.slug}</span></td>
                    <td className="px-6 py-3 text-right text-slate-500">→</td>
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
