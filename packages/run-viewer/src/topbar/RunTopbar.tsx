import type { Run } from "@journeyman/core";

export interface RunTopbarProps {
  flowName: string;
  run: Run;
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onFork?: () => void;
  busy?: boolean;
}

export function RunTopbar(p: RunTopbarProps) {
  const startedLabel = p.run.startedAt
    ? `started ${new Date(p.run.startedAt).toLocaleTimeString()}`
    : "not started";
  const isRunning = p.run.status === "running";
  const isPaused = p.run.status === "paused";
  const isTerminal = ["completed", "failed", "cancelled"].includes(p.run.status);

  const btn: React.CSSProperties = {
    background: "#2a2a3e", border: "1px solid #444", color: "#ddd",
    padding: "5px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer",
  };
  const danger: React.CSSProperties = {
    ...btn, background: "rgba(255,118,117,0.10)", borderColor: "#ff7675", color: "#ff7675",
  };

  return (
    <header className="je-runview__topbar">
      <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.flowName}</h1>
      <span className={`je-runview__pill ${p.run.status}`}>{p.run.status}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{startedLabel}</span>
      {p.run.durationMs && (
        <span style={{ color: "#888", fontSize: 11 }}>· {(p.run.durationMs / 1000).toFixed(1)}s</span>
      )}
      <div style={{ flex: 1 }} />
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
      {p.onRerun && (
        <button style={btn} disabled={p.busy} onClick={p.onRerun}>↻ Re-run</button>
      )}
    </header>
  );
}
