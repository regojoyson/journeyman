import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import type { Workflow, WorkflowInputDef } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { listFlowsPaged, updateFlowMeta, getCurrentWorkflowVersion } from "../api/flows.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { Pagination } from "@journeyman/runs-list";
import { btnPrimary, card } from "./admin-styles.ts";
import { StatusChip } from "../components/StatusChip.tsx";
import { RunFlowDialog } from "../components/RunFlowDialog.tsx";
import { runActionVisible } from "./flows-list-actions.ts";

export function FlowsListPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { can } = useWorkspace();
  const editable = can("resource.write");

  const [flows, setFlows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const navigate = useNavigate();
  const [runTarget, setRunTarget] = useState<{ id: string; name: string } | null>(null);
  const [runInputDefs, setRunInputDefs] = useState<WorkflowInputDef[]>([]);
  const [runLoadingId, setRunLoadingId] = useState<string | null>(null);

  async function fetchFlows(p: number, ps: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await listFlowsPaged(wsId, { page: p, pageSize: ps });
      setFlows(data.workflows);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchFlows(page, pageSize);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [wsId, page, pageSize]);

  const handlePageSizeChange = (n: number) => { setPageSize(n); setPage(1); };

  async function handleRename(flow: Workflow) {
    const next = window.prompt("Rename flow", flow.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === flow.name) return;
    try {
      await updateFlowMeta(wsId, flow.id, { name: trimmed });
      await fetchFlows(page, pageSize);
    } catch (e) {
      alert(`Rename failed: ${(e as Error).message}`);
    }
  }

  async function handleRun(flow: Workflow) {
    setRunLoadingId(flow.id);
    setError(null);
    try {
      const version = await getCurrentWorkflowVersion(wsId, flow.id);
      const def = version.definition;
      const startNode = def.nodes.find(
        (n) => n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
      );
      const defs = (def.inputDefs && def.inputDefs.length > 0
        ? def.inputDefs
        : getStartWorkflowInputs(startNode?.config)
      ).filter((d) => d.name.trim() !== "");
      setRunInputDefs(defs);
      setRunTarget({ id: flow.id, name: flow.name });
    } catch (e) {
      setError(`Could not load inputs: ${(e as Error).message}`);
    } finally {
      setRunLoadingId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Flows</h1>
            <p className="mt-1 text-sm text-slate-400">Browse and edit flows in this workspace.</p>
          </div>
          {editable && (
            <Link to={`/workspaces/${wsId}/workflows/new`} className={btnPrimary}>+ New flow</Link>
          )}
        </header>

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
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Description</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {flows.map(f => (
                  <tr key={f.id} className="hover:bg-surface-hover">
                    <td className="px-6 py-3 text-slate-100 font-medium">
                      {f.name}
                    </td>
                    <td className="px-6 py-3">
                      <StatusChip
                        tone={f.status === "ready" ? "success" : "warning"}
                        label={f.status === "ready" ? "Ready" : "Draft"}
                      />
                    </td>
                    <td className="px-6 py-3 text-slate-400">{f.description ?? ""}</td>
                    <td className="px-6 py-3 text-slate-500">
                      {new Date(f.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-3 text-xs">
                        {editable ? (
                          <>
                            <Link to={`/workspaces/${wsId}/workflows/${f.id}/edit`} className="text-foreground hover:text-foreground">
                              Edit
                            </Link>
                            <button
                              onClick={() => handleRename(f)}
                              className="text-foreground hover:text-foreground"
                            >Rename</button>
                          </>
                        ) : (
                          <Link to={`/workspaces/${wsId}/workflows/${f.id}/edit`} className="text-slate-400 hover:text-slate-300">
                            Open (read-only)
                          </Link>
                        )}
                        {runActionVisible(editable, f.status) && (
                          <button
                            onClick={() => handleRun(f)}
                            disabled={runLoadingId === f.id}
                            className="text-foreground hover:text-foreground"
                          >
                            {runLoadingId === f.id ? "Loading…" : "Run"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
        {runTarget && (
          <RunFlowDialog
            wsId={wsId}
            workflowId={runTarget.id}
            workflowName={runTarget.name}
            inputDefs={runInputDefs}
            onClose={() => setRunTarget(null)}
            onSubmitted={(res) => {
              setRunTarget(null);
              navigate(`/workspaces/${wsId}/workflow-instances/${res.workflowInstanceId}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
