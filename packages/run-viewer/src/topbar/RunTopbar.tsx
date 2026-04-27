import type { Run } from "@journeyman/core";

export interface RunTopbarProps {
  flowName: string;
  run: Run;
  onRerun?: () => void;
  busy?: boolean;
}

export function RunTopbar(p: RunTopbarProps) {
  const startedLabel = p.run.startedAt
    ? `started ${new Date(p.run.startedAt).toLocaleTimeString()}`
    : "not started";
  return (
    <header className="je-runview__topbar">
      <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{p.flowName}</h1>
      <span className={`je-runview__pill ${p.run.status}`}>{p.run.status}</span>
      <span style={{ color: "#888", fontSize: 11 }}>{startedLabel}</span>
      {p.run.durationMs && (
        <span style={{ color: "#888", fontSize: 11 }}>· {(p.run.durationMs / 1000).toFixed(1)}s</span>
      )}
      <div style={{ flex: 1 }} />
      {p.onRerun && (
        <button
          disabled={p.busy}
          onClick={p.onRerun}
          style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "5px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer" }}
        >↻ Re-run</button>
      )}
    </header>
  );
}
