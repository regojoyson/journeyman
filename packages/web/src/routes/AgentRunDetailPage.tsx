import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentsApi } from "../api/agents.ts";
import { getRun, openWorkflowInstanceEventStream } from "../api/runs.ts";
import type { WorkflowInstanceDetail } from "../api/runs.ts";
import type { Agent } from "@journeyman/core";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { formatDuration, isTerminalStatus } from "@journeyman/core";
import { WorkflowLogsPanel } from "@journeyman/run-viewer";
import { btnSecondary, card } from "./admin-styles.ts";
import { RunSectionNav, type RunSectionId } from "../components/agents/sections/RunSectionNav.tsx";

// ── Status pill ────────────────────────────────────────────────────────────────

const PILL_CLS: Record<string, string> = {
  running:   "bg-blue-500/15 text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  failed:    "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
  paused:    "bg-amber-500/15 text-amber-400",
};

function StatusPill({ status }: { status: string }) {
  const cls = PILL_CLS[status] ?? PILL_CLS.cancelled;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] px-2.5 py-0.5 rounded-full font-semibold ${cls}`}>
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 animate-pulse" />
      )}
      {status}
    </span>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────────

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

// ── Panel: Details ─────────────────────────────────────────────────────────────

function RunDetailsPanel({
  wi,
  provider,
  model,
  isRunning,
  repoName,
  prUrl,
  prNumber,
  displayInputs,
  outputText,
}: {
  wi: WorkflowInstanceDetail["workflowInstance"];
  provider: string;
  model: string | undefined;
  isRunning: boolean;
  repoName: string | undefined;
  prUrl: string | undefined;
  prNumber: number | undefined;
  displayInputs: Record<string, unknown>;
  outputText: string | undefined;
}) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Trigger",  value: wi.triggerSource },
    { label: "Duration", value: isRunning ? "running…" : formatDuration(wi.durationMs) },
    { label: "Model",    value: `${provider}${model ? ` · ${model}` : ""}` },
    ...(repoName ? [{
      label: "Repository",
      value: (
        <>
          {repoName}
          {prUrl && prNumber != null && (
            <> <span className="text-muted-foreground">→</span>{" "}
              <a href={prUrl} target="_blank" rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground">
                PR #{prNumber}
              </a>
            </>
          )}
        </>
      ),
    }] : []),
    ...(Object.keys(displayInputs).length > 0 ? [{
      label: "Inputs",
      value: (
        <code className="block text-[13px] font-mono text-muted-foreground bg-muted/50 border rounded px-2.5 py-1.5 break-all whitespace-pre-wrap">
          {JSON.stringify(displayInputs)}
        </code>
      ),
    }] : []),
    ...(outputText ? [{ label: "Output", value: outputText }] : []),
  ];

  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-6 gap-y-3.5 text-sm">
      {rows.map(({ label, value }) => (
        <Fragment key={label}>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground pt-0.5">
            {label}
          </div>
          <div>{value}</div>
        </Fragment>
      ))}
    </div>
  );
}

// ── Panel: Logs ────────────────────────────────────────────────────────────────

function RunLogsPanel({ events }: { events: WorkflowInstanceEvent[] }) {
  return (
    <WorkflowLogsPanel
      events={events}
      nodes={[]}
      onClose={() => {}}
      hideStepChips
    />
  );
}

// ── Panel: Tokens & Cost ───────────────────────────────────────────────────────

function RunTokensPanel() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 text-muted-foreground">
      <span className="text-3xl">🪙</span>
      <p className="text-sm font-semibold text-foreground/70">Token usage &amp; cost tracking coming soon</p>
      <p className="text-xs text-center max-w-[280px] leading-relaxed">
        Once token tracking is wired up in the backend, you'll see input tokens,
        output tokens, and estimated cost per run here.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function AgentRunDetailPage() {
  const { wsId = "", runId = "" } = useParams<{ wsId: string; runId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<WorkflowInstanceDetail | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [liveEvents, setLiveEvents] = useState<WorkflowInstanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<RunSectionId>("details");

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
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !detail) return <div className="p-6 text-sm text-destructive">{error ?? "Run not found."}</div>;

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
    <div className="h-full flex flex-col overflow-hidden">

      {/* Sticky header */}
      <header className="shrink-0 border-b bg-background px-6 pt-5 pb-4">
        <div className="text-xs text-muted-foreground mb-1.5">
          <Link
            to={`/workspaces/${wsId}/agent-runs`}
            className="hover:text-foreground transition-colors"
          >
            Agent Runs
          </Link>
          <span className="mx-1.5">/</span>
          {agentName}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{agentName}</h1>
              <StatusPill status={wi.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {wi.id.slice(0, 8)}&nbsp;·&nbsp;{fmtRelative(wi.startedAt)}
            </p>
          </div>
          <a
            href={`/workspaces/${wsId}/workflow-instances/${wi.id}`}
            className={`${btnSecondary} no-underline`}
          >
            Open workflow instance →
          </a>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">

            {/* Sidebar nav */}
            <aside className="w-44 shrink-0 border-r p-3">
              <RunSectionNav active={section} onSelect={setSection} />
            </aside>

            {/* Content panel */}
            <div className="flex-1 p-6">
              {section === "details" && (
                <RunDetailsPanel
                  wi={wi}
                  provider={provider}
                  model={model}
                  isRunning={isRunning}
                  repoName={repoName}
                  prUrl={prUrl}
                  prNumber={prNumber}
                  displayInputs={displayInputs}
                  outputText={outputText}
                />
              )}
              {section === "logs" && <RunLogsPanel events={allEvents} />}
              {section === "tokens" && <RunTokensPanel />}
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
