import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { workspaceAdminApi, type WorkspaceDetail } from "../api/workspaces.ts";
import { codePill } from "./admin-styles.ts";

export interface WorkspaceDetailContext {
  orgId: string;
  wsId: string;
  workspace: WorkspaceDetail;
  refresh: () => Promise<void>;
}

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "settings", label: "Settings" },
];

export function WorkspaceDetailPage() {
  const { orgId = "", wsId = "" } = useParams<{ orgId: string; wsId: string }>();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await workspaceAdminApi.getOne(orgId, wsId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workspace.");
    } finally {
      setLoading(false);
    }
  }, [orgId, wsId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <NavLink to={`/orgs/${orgId}/workspaces`} className="text-sm text-slate-400 hover:text-slate-200">
            ← Workspaces
          </NavLink>
          {loading ? (
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Loading…</h1>
          ) : workspace ? (
            <div className="mt-2 flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-100">{workspace.name}</h1>
              <span className={codePill}>{workspace.slug}</span>
            </div>
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Workspace not found</h1>
          )}
          {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
        </header>

        {workspace && (
          <div className="flex gap-8">
            <nav className="w-48 shrink-0 flex flex-col gap-1">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded text-sm ${isActive ? "bg-surface-hover text-slate-100 font-medium" : "text-slate-400 hover:text-slate-200"}`
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex-1 min-w-0">
              <Outlet context={{ orgId, wsId, workspace, refresh } satisfies WorkspaceDetailContext} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
