import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentsApi } from "../api/agents.ts";
import { getRun, openWorkflowInstanceEventStream } from "../api/runs.ts";
import type { WorkflowInstanceDetail } from "../api/runs.ts";
import type { Agent } from "@journeyman/core";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { formatDuration, isTerminalStatus } from "@journeyman/core";
import { WorkflowLogsPanel } from "@journeyman/run-viewer";
import { btnSecondary } from "./admin-styles.ts";

const PILL_STYLE: Record<string, React.CSSProperties> = {
  running:   { background: "rgba(74,158,255,.15)",  color: "#4a9eff" },
  completed: { background: "rgba(16,185,129,.15)",  color: "#10b981" },
  failed:    { background: "rgba(239,68,68,.15)",   color: "#ef4444" },
  cancelled: { background: "rgba(161,161,170,.15)", color: "#a1a1aa" },
  paused:    { background: "rgba(253,203,110,.15)", color: "#fbbf24" },
};

function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? PILL_STYLE.cancelled;
  return (
    <span style={{
      ...style,
      display: "inline-flex", alignItems: "center", gap: 7,
      fontSize: 13, padding: "3px 10px", borderRadius: 10, fontWeight: 600,
    }}>
      {status === "running" && (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4a9eff", flexShrink: 0, animation: "jePulse 1.4s infinite" }} />
      )}
      {status}
    </span>
  );
}

function fmtRelative(d: Date | string | null): string {
  if (!d) return "—";
  const diff = Date.now() - (d instanceof Date ? d : new Date(d)).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentRunDetailPage() {
  const { wsId = "", runId = "" } = useParams<{ wsId: string; runId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [liveEvents, setLiveEvents] = useState<WorkflowInstanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logHeight, setLogHeight] = useState(320);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getRun(wsId, runId)
      .then(d => {
        setDetail(d);
        const agentId = d.workflowInstance.inputs["agentId"] as string | undefined;
        if (agentId) {
          agentsApi.get(wsId, agentId).then(setAgent).catch(() => null);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [wsId, runId]);

  useEffect(() => {
    if (!detail || isTerminalStatus(detail.workflowInstance.status)) return;
    const lastId = detail.events.at(-1)?.id ?? 0;
    return openWorkflowInstanceEventStream({
      wsId, runId, sinceId: lastId,
      onEvent: ev => setLiveEvents(prev => [...prev, ev]),
    });
  }, [detail, wsId, runId]);

  const allEvents = useMemo(() => {
    const byId = new Map<number, WorkflowInstanceEvent>();
    for (const e of detail?.events ?? []) byId.set(e.id, e);
    for (const e of liveEvents) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [detail?.events, liveEvents]);

  if (!runId) { navigate(`/workspaces/${wsId}/agent-runs`); return null; }
  if (loading) return <div style={{ padding: 24, color: "rgb(var(--color-text-subtle) / 1)" }}>Loading…</div>;
  if (error || !detail) return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>{error ?? "Run not found."}</div>;

  const wi = detail.workflowInstance;
  const agentName  = agent?.name     ?? (wi.inputs["agentId"] as string | undefined) ?? "Agent";
  const provider   = agent?.provider ?? "claude";
  const model      = agent?.model;
  const isRunning  = !isTerminalStatus(wi.status);

  const displayInputs = { ...wi.inputs };
  delete displayInputs["agentId"];

  const prUrl     = wi.outputs?.["prUrl"]    as string | undefined;
  const prNumber  = wi.outputs?.["prNumber"] as number | undefined;
  const repoName  = (wi.inputs["repo"] ?? wi.inputs["repository"]) as string | undefined;
  const outputText = (wi.outputs?.["result"] ?? wi.outputs?.["summary"]) as string | undefined;

  return (
    <div style={{ height: "100%", overflowY: "auto", color: "rgb(var(--color-text) / 1)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 56px" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 13, color: "rgb(var(--color-text-subtle) / 1)", marginBottom: 14 }}>
          <Link to={`/workspaces/${wsId}/agent-runs`} style={{ color: "inherit", textDecoration: "none" }}>Agent Runs</Link>
          <span style={{ margin: "0 6px" }}>/</span>
          {agentName}
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{agentName}</h1>
              <StatusPill status={wi.status} />
            </div>
            <div style={{ fontSize: 13, color: "rgb(var(--color-text-subtle) / 1)", marginTop: 7, fontFamily: "ui-monospace, monospace" }}>
              {wi.id.slice(0, 8)} · {fmtRelative(wi.startedAt)}
            </div>
          </div>
          <a
            href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
            className={btnSecondary}
            style={{ textDecoration: "none" }}
          >
            Open workflow instance →
          </a>
        </div>

        {/* Stat strip */}
        <div style={{ display: "flex", gap: 48, marginTop: 32, paddingBottom: 28, borderBottom: "1px solid rgb(var(--color-border) / 1)" }}>
          {[
            { label: "Trigger",  value: wi.triggerSource },
            { label: "Duration", value: isRunning ? "running…" : formatDuration(wi.durationMs) },
            { label: "Model",    value: `${provider}${model ? ` · ${model}` : ""}` },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: ".06em", color: "rgb(var(--color-text-subtle) / 1)" }}>{label}</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Detail rows */}
        {(repoName || Object.keys(displayInputs).length > 0 || outputText) && (
          <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 14, columnGap: 24, fontSize: 14 }}>
            {repoName && (
              <>
                <div style={{ color: "rgb(var(--color-text-subtle) / 1)" }}>Repository</div>
                <div>
                  {repoName}
                  {prUrl && prNumber && (
                    <> <span style={{ color: "rgb(var(--color-text-subtle) / 1)" }}>→</span>{" "}
                      <a href={prUrl} target="_blank" rel="noreferrer" style={{ color: "rgb(var(--color-text) / 1)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                        PR #{prNumber}
                      </a>
                    </>
                  )}
                </div>
              </>
            )}
            {Object.keys(displayInputs).length > 0 && (
              <>
                <div style={{ color: "rgb(var(--color-text-subtle) / 1)" }}>Inputs</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "rgb(var(--color-text-subtle) / 1)", wordBreak: "break-all" }}>
                  {JSON.stringify(displayInputs)}
                </div>
              </>
            )}
            {outputText && (
              <>
                <div style={{ color: "rgb(var(--color-text-subtle) / 1)" }}>Output</div>
                <div>{outputText}</div>
              </>
            )}
          </div>
        )}

        {/* Logs */}
        <div style={{ marginTop: 40 }}>
          <WorkflowLogsPanel
            events={allEvents}
            nodes={[]}
            height={logHeight}
            onResizeHeight={setLogHeight}
            onClose={() => {}}
            hideStepChips
            resizeEdge="bottom"
          />
        </div>
      </div>
    </div>
  );
}
