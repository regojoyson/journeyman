import { useEffect, useState } from "react";
import type { WorkflowInstance } from "@journeyman/core";

export interface WorkflowInstanceTopbarProps {
  workflowName: string;
  workflowInstance: WorkflowInstance;
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onFork?: () => void;
  onRefresh?: () => void;
  busy?: boolean;
  logsOpen?: boolean;
  logsCount?: number;
  onToggleLogs?: () => void;
}

const AUTO_REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: "Off", ms: 0 },
  { label: "3s", ms: 3000 },
  { label: "5s", ms: 5000 },
  { label: "10s", ms: 10000 },
];

export function WorkflowInstanceTopbar(p: WorkflowInstanceTopbarProps) {
  const [autoRefreshMs, setAutoRefreshMs] = useState(5000);

  useEffect(() => {
    if (!p.onRefresh || autoRefreshMs === 0) return;
    const handle = setInterval(() => p.onRefresh!(), autoRefreshMs);
    return () => clearInterval(handle);
  }, [autoRefreshMs, p.onRefresh]);

  const startedLabel = p.workflowInstance.startedAt
    ? `started ${new Date(p.workflowInstance.startedAt).toLocaleTimeString()}`
    : "not started";
  const isRunning = p.workflowInstance.status === "running";
  const isPaused = p.workflowInstance.status === "paused";
  const isTerminal = ["completed", "failed", "cancelled"].includes(p.workflowInstance.status);

  const btn: React.CSSProperties = {
    background: "#2a2a3e", border: "1px solid #444", color: "#ddd",
    padding: "5px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer",
  };
  const danger: React.CSSProperties = {
    ...btn, background: "rgba(255,118,117,0.10)", borderColor: "#ff7675", color: "#ff7675",
  };

  return (
    <header className="je-runview__topbar">
      <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.workflowName}</h1>
      <span className={`je-runview__pill ${p.workflowInstance.status}`}>{p.workflowInstance.status}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{startedLabel}</span>
      {p.workflowInstance.durationMs && (
        <span style={{ color: "#888", fontSize: 11 }}>· {(p.workflowInstance.durationMs / 1000).toFixed(1)}s</span>
      )}
      <div style={{ flex: 1 }} />
      {p.onRefresh && (
        <>
          <button style={btn} disabled={p.busy} onClick={p.onRefresh} title="Refresh now">↻ Refresh</button>
          <label style={{ color: "#888", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            Auto
            <select
              value={autoRefreshMs}
              onChange={e => setAutoRefreshMs(Number(e.target.value))}
              style={{
                background: "#2a2a3e", border: "1px solid #444", color: "#ddd",
                padding: "4px 6px", borderRadius: 5, fontSize: 12, cursor: "pointer",
              }}
            >
              {AUTO_REFRESH_OPTIONS.map(o => (
                <option key={o.ms} value={o.ms}>{o.label}</option>
              ))}
            </select>
          </label>
        </>
      )}
      {isRunning && p.onPause && (
        <button style={btn} disabled={p.busy} onClick={p.onPause}>⏸ Pause</button>
      )}
      {isPaused && p.onResume && (
        <button style={btn} disabled={p.busy} onClick={p.onResume}>▶ Resume</button>
      )}
      {!isTerminal && p.onCancel && (
        <button style={danger} disabled={p.busy} onClick={p.onCancel}>⏹ Cancel</button>
      )}
      {p.onExport && (
        <button style={btn} disabled={p.busy} onClick={p.onExport}>⬇ Export</button>
      )}
      {isTerminal && p.onFork && (
        <button style={btn} disabled={p.busy} onClick={p.onFork}>✏ Fork &amp; edit</button>
      )}
      {p.onToggleLogs && (
        <button
          style={btn}
          onClick={p.onToggleLogs}
          title={p.logsOpen ? "Hide logs panel" : "Show logs panel"}
        >
          {p.logsOpen ? "▾ Hide logs" : "▴ Show logs"}
          {typeof p.logsCount === "number" && p.logsCount > 0 && (
            <span style={{ marginLeft: 6, color: "#888", fontSize: 11 }}>
              ({p.logsCount})
            </span>
          )}
        </button>
      )}
      {p.onRerun && (
        <button style={btn} disabled={p.busy} onClick={p.onRerun}>↻ Re-run</button>
      )}
    </header>
  );
}
