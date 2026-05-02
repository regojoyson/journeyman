import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunsList, type RunFilter } from "@journeyman/runs-list";
import type { Flow, Run, RunInputDef, RunListScope, IssueRefProvider } from "@journeyman/core";
import { buildIssueRef } from "@journeyman/core";
import { listRuns, rerunRun } from "../api/runs.ts";
import { getCurrentFlowVersion, listFlows, runFlow } from "../api/flows.ts";
import { RunSubmittedToast } from "../components/RunSubmittedToast.tsx";
import { useAuth } from "../AuthContext.tsx";

const SCOPE_LABELS: Record<string, string> = { user: "Personal", org: "Org", global: "Global" };

function scopeBadgeStyle(scope: string): React.CSSProperties {
  if (scope === "org") return { background: "rgba(37,99,235,0.18)", color: "#93c5fd", border: "1px solid rgba(37,99,235,0.4)" };
  if (scope === "global") return { background: "rgba(124,58,237,0.18)", color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.4)" };
  return { background: "rgba(107,114,128,0.18)", color: "#d1d5db", border: "1px solid rgba(107,114,128,0.4)" };
}

interface NewRunDialogProps {
  onClose: () => void;
  onSubmitted: (res: { runId: string; engineWorkflowId: string }) => void;
}

function NewRunDialog({ onClose, onSubmitted }: NewRunDialogProps) {
  const { isPlatformAdmin } = useAuth();
  const [flowId, setFlowId] = useState("");
  const [provider, setProvider] = useState<IssueRefProvider>("jira");
  const [rawId, setRawId] = useState("");
  const issueRef = rawId.trim() ? buildIssueRef(provider, rawId.trim()) : "";
  const [dynValues, setDynValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const flowsQ = useQuery({
    queryKey: ["flows-all"],
    queryFn: () => listFlows(),
  });

  const versionQ = useQuery({
    queryKey: ["flow-version-current", flowId],
    queryFn: () => getCurrentFlowVersion(flowId),
    enabled: !!flowId,
  });

  const inputDefs: RunInputDef[] = versionQ.data?.definition.inputDefs ?? [];

  const submitM = useMutation({
    mutationFn: () => {
      const inputs: Record<string, unknown> = {};
      if (issueRef.trim()) inputs.issueRef = issueRef.trim();
      for (const def of inputDefs) {
        const raw = dynValues[def.name] ?? "";
        if (def.type === "number") inputs[def.name] = Number(raw);
        else if (def.type === "boolean") inputs[def.name] = raw === "true";
        else if (def.type === "json") {
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

  const flows: Flow[] = (flowsQ.data ?? []).filter(
    f => isPlatformAdmin || f.scope !== "global",
  );

  const grouped = {
    user: flows.filter(f => f.scope === "user"),
    org: flows.filter(f => f.scope === "org"),
    global: flows.filter(f => f.scope === "global"),
  };

  const missingRequired = inputDefs
    .filter(d => d.required && !dynValues[d.name]?.trim())
    .map(d => d.name);
  const canRun = !!flowId && missingRequired.length === 0 && !submitM.isPending;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 10,
        padding: 28, minWidth: 440, maxWidth: 560, width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5)", color: "#fff",
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700 }}>New Run</h3>

        {/* Flow selector */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 5 }}>Workflow *</span>
          <select
            value={flowId}
            onChange={e => { setFlowId(e.target.value); setDynValues({}); setError(null); }}
            style={{ width: "100%", background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
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

        {/* Issue Ref */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 5 }}>Issue Ref</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as IssueRefProvider)}
              style={{ background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
            >
              <option value="jira">Jira</option>
              <option value="github">GitHub</option>
              <option value="monday">Monday</option>
              <option value="linear">Linear</option>
            </select>
            <input
              type="text"
              value={rawId}
              onChange={e => setRawId(e.target.value)}
              placeholder={
                provider === "jira"   ? "PROJ-123" :
                provider === "github" ? "owner/repo#42" :
                provider === "monday" ? "12345678" :
                "ENG-99"
              }
              style={{ flex: 1, background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
            />
          </div>
          {issueRef && (
            <span style={{ fontSize: 11, color: "#6c5ce7", display: "block", marginTop: 4 }}>
              → {issueRef}
            </span>
          )}
        </label>

        {/* Dynamic inputs from flow definition */}
        {versionQ.isLoading && flowId && (
          <div style={{ color: "#888", fontSize: 12, marginBottom: 12 }}>Loading flow inputs…</div>
        )}
        {inputDefs.map(def => (
          <label key={def.name} style={{ display: "block", marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 5 }}>
              {def.name}{def.required && <span style={{ color: "#ff7675" }}> *</span>}
              {def.description && <span style={{ color: "#666", marginLeft: 6 }}>— {def.description}</span>}
            </span>
            {def.type === "boolean" ? (
              <select
                value={dynValues[def.name] ?? ""}
                onChange={e => setDynValues(v => ({ ...v, [def.name]: e.target.value }))}
                style={{ width: "100%", background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
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
                placeholder={def.type === "json" ? '{"key": "value"}' : undefined}
                style={{ width: "100%", background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
              />
            )}
          </label>
        ))}

        {error && (
          <div style={{ color: "#ff7675", fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "1px solid #444", color: "#ccc", padding: "7px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >Cancel</button>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => submitM.mutate()}
            style={{ background: canRun ? "#6c5ce7" : "#2a2a3e", border: "none", color: canRun ? "#fff" : "#555", padding: "7px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: canRun ? "pointer" : "default", fontFamily: "inherit" }}
          >{submitM.isPending ? "Starting…" : "Run"}</button>
        </div>
      </div>
    </div>
  );
}

export function RunsListPage() {
  const [filter, setFilter] = useState<RunFilter>({});
  const [scope, setScope] = useState<RunListScope>("mine");
  const [showDialog, setShowDialog] = useState(false);
  const [runToast, setRunToast] = useState<{ runId: string; engineWorkflowId: string } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const auth = useAuth();

  const q = useQuery({
    queryKey: ["runs", filter, scope],
    queryFn: () => listRuns({ status: filter.status, flowId: filter.flowId, provider: filter.provider, issueRef: filter.issueRef, scope }),
    refetchInterval: 4000,
  });

  const rerunM = useMutation({
    mutationFn: (r: Run) => rerunRun(r.id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${res.runId}`);
    },
  });

  return (
    <>
      <RunsList
        runs={q.data ?? []}
        isLoading={q.isLoading}
        filter={filter}
        onFilterChange={setFilter}
        onSelectRun={(id) => navigate(`/runs/${id}`)}
        onRerun={(r) => rerunM.mutate(r)}
        onNewRun={() => setShowDialog(true)}
        scope={scope}
        onScopeChange={setScope}
        showOrgChip={!!auth.activeOrgId}
        showAllChip={auth.isPlatformAdmin}
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
          runId={runToast.runId}
          engineWorkflowId={runToast.engineWorkflowId}
          onViewLive={() => { navigate(`/runs/${runToast.runId}`); setRunToast(null); }}
          onDismiss={() => setRunToast(null)}
        />
      )}
    </>
  );
}
