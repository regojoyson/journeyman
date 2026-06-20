import type { CSSProperties } from "react";
import type { AgentRunEnriched } from "../../api/agents.ts";
import { formatDuration } from "@journeyman/core";
import { btnSecondary } from "../../routes/admin-styles.ts";
import { refLabel } from "@journeyman/runs-list";

interface AgentRunsListProps {
  runs: AgentRunEnriched[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  statusFilter: string;
  agentFilter: string;
  triggerFilter: string;
  agents: Array<{ id: string; name: string }>;
  onStatusFilter: (s: string) => void;
  onAgentFilter: (id: string) => void;
  onTriggerFilter: (t: string) => void;
  onPageChange: (p: number) => void;
  onSelectRun: (id: string) => void;
  onRerun: (run: AgentRunEnriched) => void;
}

const STATUS_GROUPS = ["", "running", "failed"] as const;
const STATUS_LABELS: Record<string, string> = { "": "All", running: "Running", failed: "Failed" };

const PILL_STYLE: Record<string, CSSProperties> = {
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
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, padding: "2px 8px", borderRadius: 8, fontWeight: 600,
      textTransform: "uppercase",
    }}>
      {status === "running" && (
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#4a9eff", flexShrink: 0,
          animation: "jePulse 1.4s infinite",
        }} />
      )}
      {status}
    </span>
  );
}

function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function AgentRunsList(p: AgentRunsListProps) {
  const totalPages = Math.ceil(p.total / p.pageSize);
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to   = Math.min(p.page * p.pageSize, p.total);

  const chipStyle = (active: boolean): CSSProperties => ({
    background: active ? "rgb(var(--color-text) / 1)" : "rgb(var(--color-surface) / 1)",
    border: `1px solid ${active ? "rgb(var(--color-text) / 1)" : "rgb(var(--color-border) / 1)"}`,
    color: active ? "rgb(var(--color-bg) / 1)" : "rgb(var(--color-text) / 1)",
    padding: "4px 12px", borderRadius: 14, fontSize: 12, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
  });

  const selStyle: CSSProperties = {
    background: "rgb(var(--color-surface) / 1)",
    border: "1px solid rgb(var(--color-border) / 1)",
    color: "rgb(var(--color-text) / 1)",
    padding: "4px 10px", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
  };

  return (
    <div style={{ padding: 24, color: "rgb(var(--color-text) / 1)", fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Agent Runs</h2>

        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {STATUS_GROUPS.map(s => (
            <button key={s} type="button" onClick={() => p.onStatusFilter(s)} style={chipStyle(p.statusFilter === s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <select value={p.agentFilter} onChange={e => p.onAgentFilter(e.target.value)} style={selStyle}>
          <option value="">All agents</option>
          {p.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select value={p.triggerFilter} onChange={e => p.onTriggerFilter(e.target.value)} style={selStyle}>
          <option value="">All triggers</option>
          {["manual", "webhook", "schedule", "api"].map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      {p.isLoading ? (
        <div style={{ color: "rgb(var(--color-text-subtle) / 1)" }}>Loading…</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgb(var(--color-border) / 1)" }}>
              {["Agent", "Status", "Trigger", "Started", "Duration", "Model", ""].map(h => (
                <th key={h} style={{ padding: "8px 6px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 500, color: "rgb(var(--color-text-subtle) / 1)", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.runs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "16px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>No runs match the current filters.</td>
              </tr>
            )}
            {p.runs.map(r => {
              const agentRef = refLabel(r.inputs);
              return (
                <tr
                  key={r.id}
                  onClick={() => p.onSelectRun(r.id)}
                  style={{ borderBottom: "1px solid rgb(var(--color-border) / 1)", cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "rgb(var(--color-surface-hover) / 1)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
                >
                  <td style={{ padding: "10px 6px" }} title={agentRef?.full}>
                    <div style={{ fontWeight: 500 }}>{r.agentName}</div>
                    {agentRef && (
                      <>
                        <div style={{ fontSize: 10, color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 2 }}>
                          {agentRef.keyLabel}
                        </div>
                        <div style={{ fontSize: 11, color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {agentRef.valueText}
                        </div>
                      </>
                    )}
                  </td>
                  <td style={{ padding: "10px 6px" }}><StatusPill status={r.status} /></td>
                  <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>{r.triggerSource}</td>
                  <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>{fmtRelative(r.startedAt)}</td>
                  <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)" }}>
                    {r.status === "running"
                      ? `${formatDuration(r.startedAt ? Date.now() - new Date(r.startedAt).getTime() : null)}…`
                      : formatDuration(r.durationMs)}
                  </td>
                  <td style={{ padding: "10px 6px", color: "rgb(var(--color-text-subtle) / 1)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                    {r.provider}{r.model ? ` · ${r.model}` : ""}
                  </td>
                  <td style={{ padding: "10px 6px" }}>
                    {r.status !== "running" && (
                      <button
                        type="button"
                        className={btnSecondary}
                        onClick={e => { e.stopPropagation(); p.onRerun(r); }}
                      >
                        Re-run
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {p.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 16, fontSize: 12, color: "rgb(var(--color-text-subtle) / 1)" }}>
          <span>{from}–{to} of {p.total}</span>
          <button type="button" className={btnSecondary} disabled={p.page <= 1} onClick={() => p.onPageChange(p.page - 1)}>← Prev</button>
          <button type="button" className={btnSecondary} disabled={p.page >= totalPages} onClick={() => p.onPageChange(p.page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
