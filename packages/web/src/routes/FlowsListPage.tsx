import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Workflow } from "@journeyman/core";
import { listFlowsPaged, updateFlowMeta } from "../api/flows.ts";
import { cloneFlow, promoteFlow, deleteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";
import { Pagination } from "@journeyman/runs-list";
import { btnGhost, btnPrimary, card } from "./admin-styles.ts";

function canEditFlow(
  flow: Workflow,
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

  const [flows, setFlows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "org" | "global">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  async function fetchFlows(scope: typeof scopeFilter, p: number, ps: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await listFlowsPaged({
        scope: scope === "all" ? undefined : scope,
        page: p,
        pageSize: ps,
      });
      setFlows(data.workflows);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchFlows(scopeFilter, page, pageSize);
  }, [scopeFilter, page, pageSize]);

  const handleScopeChange = (s: typeof scopeFilter) => { setScopeFilter(s); setPage(1); };
  const handlePageSizeChange = (n: number) => { setPageSize(n); setPage(1); };

  const ctx = {
    userId: user?.id ?? "",
    orgId: activeOrgId,
    role,
    isPlatformAdmin,
  };

  async function handleClone(flow: Workflow) {
    try {
      const { id } = await cloneFlow(flow.id);
      navigate(`/workflows/${id}/edit`);
    } catch (e) {
      alert(`Clone failed: ${(e as Error).message}`);
    }
  }

  async function handlePromote(flow: Workflow, targetScope: "org" | "global") {
    try {
      await promoteFlow(flow.id, { targetScope });
      await fetchFlows(scopeFilter, page, pageSize);
    } catch (e) {
      alert(`Promote failed: ${(e as Error).message}`);
    }
  }

  async function handleRename(flow: Workflow) {
    const next = window.prompt("Rename flow", flow.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === flow.name) return;
    try {
      await updateFlowMeta(flow.id, { name: trimmed });
      await fetchFlows(scopeFilter, page, pageSize);
    } catch (e) {
      alert(`Rename failed: ${(e as Error).message}`);
    }
  }

  async function handleDelete(flow: Workflow) {
    if (!window.confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    try {
      await deleteFlow(flow.id);
      await fetchFlows(scopeFilter, page, pageSize);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

  const filterLabel = (s: typeof scopeFilter) =>
    s === "user" ? "Mine" : s === "org" ? "Organization" : s === "global" ? "Global" : "All";

  const scopeBadge = (scope: Workflow["scope"]) => {
    const cls =
      scope === "global"
        ? "bg-accent/10 text-accent border-violet-800/60"
        : scope === "org"
        ? "bg-info/10 text-info border-blue-800/60"
        : "bg-slate-800/60 text-slate-300 border-slate-700";
    return (
      <span className={`ml-2 inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
        {scope}
      </span>
    );
  };

  const statusBadge = (status: Workflow["status"]) => {
    const cls = status === "ready"
      ? "bg-success/10 text-success border-emerald-800/60"
      : "bg-warning/10 text-warning border-amber-800/60";
    const label = status === "ready" ? "Ready" : "Draft";
    return (
      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Flows</h1>
            <p className="mt-1 text-sm text-slate-400">Browse, edit, clone and promote flows.</p>
          </div>
          <Link to="/workflows/new" className={btnPrimary}>+ New flow</Link>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["all", "user", "org", "global"] as const).map(s => {
            const active = scopeFilter === s;
            return (
              <button
                key={s}
                onClick={() => handleScopeChange(s)}
                className={
                  active
                    ? "rounded-md border border-indigo-400/60 bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-accent transition"
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
            <div className="p-6 text-sm text-danger border border-danger/25 bg-danger/10 rounded-md">
              Error: {error}
            </div>
          ) : flows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No flows yet. Click "+ New flow" to create one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Description</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {flows.map(f => {
                  const editable = canEditFlow(f, ctx);
                  return (
                    <tr key={f.id} className="hover:bg-surface-hover">
                      <td className="px-6 py-3 text-slate-100 font-medium">
                        {f.name}
                        {scopeBadge(f.scope)}
                      </td>
                      <td className="px-6 py-3">{statusBadge(f.status)}</td>
                      <td className="px-6 py-3 text-slate-400">{f.description ?? ""}</td>
                      <td className="px-6 py-3 text-slate-500">
                        {new Date(f.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-3 text-xs">
                          {editable ? (
                            <>
                              <Link to={`/workflows/${f.id}/edit`} className="text-accent hover:text-accent">
                                Edit
                              </Link>
                              <button
                                onClick={() => handleRename(f)}
                                className="text-accent hover:text-accent"
                              >Rename</button>
                              <button
                                onClick={() => handleClone(f)}
                                className="text-accent hover:text-accent"
                              >Clone</button>
                              <button
                                onClick={() => handleDelete(f)}
                                className="text-danger hover:text-danger"
                              >Delete</button>
                              {f.scope === "user" && (
                                <button
                                  onClick={() => handlePromote(f, "org")}
                                  className="text-warning hover:text-warning"
                                >Promote → Org</button>
                              )}
                              {(f.scope === "org" || f.scope === "user") && (
                                <button
                                  onClick={() => handlePromote(f, "global")}
                                  className="text-accent hover:text-accent"
                                >Promote → Global</button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleClone(f)}
                                className="text-accent hover:text-accent"
                              >Clone to my flows</button>
                              <Link to={`/workflows/${f.id}/edit`} className="text-slate-400 hover:text-slate-300">
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
        {!loading && !error && total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </div>
    </div>
  );
}
