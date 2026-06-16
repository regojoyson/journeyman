import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkflowInstancesList, type WorkflowInstanceFilter } from "@journeyman/runs-list";
import type { Workflow, WorkflowInstance, WorkflowInputDef, WorkflowInstanceListScope } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { listRunsPaged, rerunRun } from "../api/runs.ts";
import { getCurrentWorkflowVersion, listFlows, runFlow } from "../api/flows.ts";
import { RunSubmittedToast } from "../components/RunSubmittedToast.tsx";
import { useAuth } from "../AuthContext.tsx";

const SCOPE_LABELS: Record<string, string> = { user: "Personal", org: "Org", global: "Global" };

function scopeBadgeStyle(scope: string): React.CSSProperties {
  if (scope === "org") return { background: "rgba(37,99,235,0.18)", color: "rgb(var(--color-info) / 1)", border: "1px solid rgba(37,99,235,0.4)" };
  if (scope === "global") return { background: "rgba(124,58,237,0.18)", color: "rgb(var(--color-accent) / 1)", border: "1px solid rgba(124,58,237,0.4)" };
  return { background: "rgba(107,114,128,0.18)", color: "rgb(var(--color-text) / 1)", border: "1px solid rgba(107,114,128,0.4)" };
}

interface NewRunDialogProps {
  onClose: () => void;
  onSubmitted: (res: { workflowInstanceId: string; engineWorkflowId: string }) => void;
}

function NewRunDialog({ onClose, onSubmitted }: NewRunDialogProps) {
  const { isPlatformAdmin } = useAuth();
  const [flowId, setFlowId] = useState("");
  const [dynValues, setDynValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const flowsQ = useQuery({
    queryKey: ["flows-all"],
    queryFn: () => listFlows(),
  });

  const versionQ = useQuery({
    queryKey: ["flow-version-current", flowId],
    queryFn: () => getCurrentWorkflowVersion(flowId),
    enabled: !!flowId,
  });

  const def = versionQ.data?.definition;
  const startNode = def?.nodes.find(n =>
    n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
  );
  const inputDefs: WorkflowInputDef[] = (def?.inputDefs && def.inputDefs.length > 0)
    ? def.inputDefs
    : getStartWorkflowInputs(startNode?.config);
  const dynamicDefs = inputDefs.filter(d => d.name.trim() !== "");

  const submitM = useMutation({
    mutationFn: () => {
      const inputs: Record<string, unknown> = {};
      for (const def of dynamicDefs) {
        const raw = dynValues[def.name] ?? "";
        if (def.type === "number") inputs[def.name] = Number(raw);
        else if (def.type === "boolean") inputs[def.name] = raw === "true";
        else if (def.type === "json-object" || def.type === "json-array") {
          try { inputs[def.name] = JSON.parse(raw); }
          catch { throw new Error(`Invalid JSON for "${def.name}"`); }
        } else {
          inputs[def.name] = raw;
        }
      }
      return runFlow(flowId, inputs);
    },
    onSuccess: onSubmitted,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to start run."),
  });

  const flows: Workflow[] = (flowsQ.data ?? []).filter(
    f => f.status === "ready" && (isPlatformAdmin || f.scope !== "global"),
  );

  const grouped = {
    user: flows.filter(f => f.scope === "user"),
    org: flows.filter(f => f.scope === "org"),
    global: flows.filter(f => f.scope === "global"),
  };

  const missingRequired = dynamicDefs
    .filter(d => d.required && !dynValues[d.name]?.trim())
    .map(d => d.name);
  const canRun = !!flowId && missingRequired.length === 0 && !submitM.isPending;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "rgb(var(--color-surface) / 1)", border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 10,
        padding: 28, minWidth: 440, maxWidth: 560, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)", color: "rgb(var(--color-text) / 1)",
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700 }}>New Run</h3>

        {/* Flow selector */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)", display: "block", marginBottom: 5 }}>Workflow *</span>
          <select
            value={flowId}
            onChange={e => { setFlowId(e.target.value); setDynValues({}); setError(null); }}
            style={{ width: "100%", background: "rgb(var(--color-bg) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
          >
            <option value="">— select a workflow —</option>
            {(["user", "org", "global"] as const).map(scope =>
              grouped[scope].length > 0 && (
                <optgroup key={scope} label={SCOPE_LABELS[scope]}>
                  {grouped[scope].map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
          {flowId && (() => {
            const f = flows.find(x => x.id === flowId);
            return f ? (
              <span style={{
                display: "inline-block", marginTop: 5, fontSize: 10, fontWeight: 600,
                padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.04em",
                ...scopeBadgeStyle(f.scope),
              }}>{SCOPE_LABELS[f.scope]}</span>
            ) : null;
          })()}
        </label>

        {/* Dynamic inputs from flow definition */}
        {versionQ.isLoading && flowId && (
          <div style={{ color: "rgb(var(--color-text-muted) / 1)", fontSize: 12, marginBottom: 12 }}>Loading flow inputs…</div>
        )}
        {dynamicDefs.map(def => (
          <label key={def.name} style={{ display: "block", marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)", display: "block", marginBottom: 5 }}>
              {def.name}{def.required && <span style={{ color: "rgb(var(--color-danger) / 1)" }}> *</span>}
              {def.description && <span style={{ color: "rgb(var(--color-border-strong) / 1)", marginLeft: 6 }}>— {def.description}</span>}
            </span>
            {def.type === "boolean" ? (
              <select
                value={dynValues[def.name] ?? ""}
                onChange={e => setDynValues(v => ({ ...v, [def.name]: e.target.value }))}
                style={{ width: "100%", background: "rgb(var(--color-bg) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
              >
                <option value="">— select —</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={def.type === "number" ? "number" : "text"}
                value={dynValues[def.name] ?? ""}
                onChange={e => setDynValues(v => ({ ...v, [def.name]: e.target.value }))}
                placeholder={def.type === "json-object" ? '{"key": "value"}' : def.type === "json-array" ? '[ ... ]' : undefined}
                style={{ width: "100%", background: "rgb(var(--color-bg) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
              />
            )}
          </label>
        ))}

        {error && (
          <div style={{ color: "rgb(var(--color-danger) / 1)", fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "7px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >Cancel</button>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => submitM.mutate()}
            style={{ background: canRun ? "rgb(var(--color-accent) / 1)" : "rgb(var(--color-surface-raised) / 1)", border: "none", color: canRun ? "#fff" /* theme-colors-allow: white-on-accent */ : "rgb(var(--color-border-strong) / 1)", padding: "7px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: canRun ? "pointer" : "default", fontFamily: "inherit" }}
          >{submitM.isPending ? "Starting…" : "Run"}</button>
        </div>
      </div>
    </div>
  );
}

export function RunsListPage() {
  const [filter, setFilter] = useState<WorkflowInstanceFilter>({});
  const [scope, setScope] = useState<WorkflowInstanceListScope>("mine");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showDialog, setShowDialog] = useState(false);
  const [runToast, setRunToast] = useState<{ workflowInstanceId: string; engineWorkflowId: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const auth = useAuth();

  const handleFilterChange = (next: WorkflowInstanceFilter) => { setFilter(next); setPage(1); };
  const handleScopeChange = (s: WorkflowInstanceListScope) => { setScope(s); setPage(1); };
  const handlePageSizeChange = (n: number) => { setPageSize(n); setPage(1); };

  const q = useQuery({
    queryKey: ["runs", filter, scope, page, pageSize],
    queryFn: () => listRunsPaged({
      status: filter.status, workflowId: filter.workflowId, provider: filter.provider,
      scope, page, pageSize,
    }),
    refetchInterval: 4000,
  });

  const rerunM = useMutation({
    mutationFn: (r: WorkflowInstance) => rerunRun(r.id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/workflow-instances/${res.workflowInstanceId}`);
    },
  });

  return (
    <>
      <WorkflowInstancesList
        workflowInstances={q.data?.workflowInstances ?? []}
        isLoading={q.isLoading}
        filter={filter}
        onFilterChange={handleFilterChange}
        onSelectWorkflowInstance={(id) => navigate(`/workflow-instances/${id}`)}
        onRerun={(r) => rerunM.mutate(r)}
        onNewWorkflowInstance={() => setShowDialog(true)}
        scope={scope}
        onScopeChange={handleScopeChange}
        showOrgChip={!!auth.activeOrgId}
        showAllChip={auth.isPlatformAdmin}
        pagination={{
          page,
          pageSize,
          total: q.data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: handlePageSizeChange,
        }}
      />
      {showDialog && (
        <NewRunDialog
          onClose={() => setShowDialog(false)}
          onSubmitted={(res) => {
            setShowDialog(false);
            qc.invalidateQueries({ queryKey: ["runs"] });
            setRunToast(res);
          }}
        />
      )}
      {runToast && (
        <RunSubmittedToast
          workflowInstanceId={runToast.workflowInstanceId}
          engineWorkflowId={runToast.engineWorkflowId}
          onViewLive={() => { navigate(`/workflow-instances/${runToast.workflowInstanceId}`); setRunToast(null); }}
          onDismiss={() => setRunToast(null)}
        />
      )}
    </>
  );
}
