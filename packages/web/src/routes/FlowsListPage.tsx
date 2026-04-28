import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Flow } from "@journeyman/core";
import { listFlows } from "../api/flows.ts";
import { cloneFlow, promoteFlow, deleteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";
import { btnGhost, btnPrimary, card } from "./admin-styles.ts";

function canEditFlow(
  flow: Flow,
  ctx: { userId: string; orgId: string; role: string; isPlatformAdmin: boolean },
): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (flow.scope === "global") return false;
  if (flow.scope === "org") return ctx.role === "admin" && flow.orgId === ctx.orgId;
  /* user */ return flow.ownerUserId === ctx.userId;
}

export function FlowsListPage() {
  const navigate = useNavigate();
  const { user, activeOrgId, role, isPlatformAdmin } = useAuth();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "org" | "global">("all");

  async function fetchFlows(scope: typeof scopeFilter) {
    setLoading(true);
    setError(null);
    try {
      const data = await listFlows(scope === "all" ? undefined : { scope });
      setFlows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchFlows(scopeFilter);
  }, [scopeFilter]);

  const ctx = {
    userId: user?.id ?? "",
    orgId: activeOrgId,
    role,
    isPlatformAdmin,
  };

  async function handleClone(flow: Flow) {
    try {
      const { id } = await cloneFlow(flow.id);
      navigate(`/flows/${id}/edit`);
    } catch (e) {
      alert(`Clone failed: ${(e as Error).message}`);
    }
  }

  async function handlePromote(flow: Flow, targetScope: "org" | "global") {
    try {
      await promoteFlow(flow.id, { targetScope });
      await fetchFlows(scopeFilter);
    } catch (e) {
      alert(`Promote failed: ${(e as Error).message}`);
    }
  }

  async function handleDelete(flow: Flow) {
    if (!window.confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    try {
      await deleteFlow(flow.id);
      await fetchFlows(scopeFilter);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

  const filterLabel = (s: typeof scopeFilter) =>
    s === "user" ? "Mine" : s === "org" ? "Organization" : s === "global" ? "Global" : "All";

  const scopeBadge = (scope: Flow["scope"]) => {
    const cls =
      scope === "global"
        ? "bg-violet-900/40 text-violet-200 border-violet-800/60"
        : scope === "org"
        ? "bg-blue-900/40 text-blue-200 border-blue-800/60"
        : "bg-slate-800/60 text-slate-300 border-slate-700";
    return (
      <span className={`ml-2 inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
        {scope}
      </span>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Flows</h1>
            <p className="mt-1 text-sm text-slate-400">Browse, edit, clone and promote flows.</p>
          </div>
          <Link to="/flows/new" className={btnPrimary}>+ New flow</Link>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["all", "user", "org", "global"] as const).map(s => {
            const active = scopeFilter === s;
            return (
              <button
                key={s}
                onClick={() => setScopeFilter(s)}
                className={
                  active
                    ? "rounded-md border border-indigo-400/60 bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-200 transition"
                    : btnGhost
                }
              >
                {filterLabel(s)}
              </button>
            );
          })}
        </div>

        <section className={`${card} overflow-hidden`}>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-300 border border-rose-900/40 bg-rose-950/30 rounded-md">
              Error: {error}
            </div>
          ) : flows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No flows yet. Click "+ New flow" to create one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Description</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {flows.map(f => {
                  const editable = canEditFlow(f, ctx);
                  return (
                    <tr key={f.id} className="hover:bg-slate-800/30">
                      <td className="px-6 py-3 text-slate-100 font-medium">
                        {f.name}
                        {scopeBadge(f.scope)}
                      </td>
                      <td className="px-6 py-3 text-slate-400">{f.description ?? ""}</td>
                      <td className="px-6 py-3 text-slate-500">
                        {new Date(f.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-3 text-xs">
                          {editable ? (
                            <>
                              <Link to={`/flows/${f.id}/edit`} className="text-indigo-300 hover:text-indigo-200">
                                Edit
                              </Link>
                              <button
                                onClick={() => handleClone(f)}
                                className="text-indigo-300 hover:text-indigo-200"
                              >Clone</button>
                              <button
                                onClick={() => handleDelete(f)}
                                className="text-rose-300 hover:text-rose-200"
                              >Delete</button>
                              {f.scope === "user" && (
                                <button
                                  onClick={() => handlePromote(f, "org")}
                                  className="text-amber-300 hover:text-amber-200"
                                >Promote → Org</button>
                              )}
                              {(f.scope === "org" || f.scope === "user") && (
                                <button
                                  onClick={() => handlePromote(f, "global")}
                                  className="text-violet-300 hover:text-violet-200"
                                >Promote → Global</button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleClone(f)}
                                className="text-indigo-300 hover:text-indigo-200"
                              >Clone to my flows</button>
                              <Link to={`/flows/${f.id}/edit`} className="text-slate-400 hover:text-slate-300">
                                Open (read-only)
                              </Link>
                            </>
                          )}
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
