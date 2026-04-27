import type { NodeExecution, RunEvent } from "@journeyman/core";
import type { ResolvedNodeStatus } from "../types.ts";

export interface NodeDetailDrawerProps {
  nodeId: string | null;
  displayName: string | null;
  status: ResolvedNodeStatus | null;
  events: RunEvent[];
  executions: NodeExecution[];
}

export function NodeDetailDrawer(p: NodeDetailDrawerProps) {
  if (!p.nodeId) {
    return (
      <aside className="je-runview__drawer">
        <div style={{ color: "#888", textAlign: "center", padding: "24px 12px" }}>
          Click a node to inspect it.
        </div>
      </aside>
    );
  }
  const lastExec = [...p.executions].sort((a, b) => b.attempt - a.attempt)[0] ?? null;
  const logs = p.events.filter(e => e.eventType === "phase.log");

  return (
    <aside className="je-runview__drawer">
      <h2>{p.displayName ?? p.nodeId}</h2>
      <div style={{ color: "#aaa", fontSize: 11, marginBottom: 10 }}>
        {p.status ? `${p.status.status} · attempt ${p.status.attempt || 0}` : "no status"}
        {p.status?.durationMs ? ` · ${(p.status.durationMs / 1000).toFixed(1)}s` : ""}
      </div>

      <div className="je-runview__section">
        <h3>Input</h3>
        <pre className="je-runview__pre">{JSON.stringify(lastExec?.input ?? {}, null, 2)}</pre>
      </div>

      <div className="je-runview__section">
        <h3>Output</h3>
        <pre className="je-runview__pre">
          {lastExec?.output ? JSON.stringify(lastExec.output, null, 2) : "—"}
        </pre>
      </div>

      {p.status?.errorClass && (
        <div className="je-runview__section">
          <h3>Error</h3>
          <pre className="je-runview__pre" style={{ color: "#ff7675" }}>
            {p.status.errorClass}{lastExec?.errorMessage ? `\n\n${lastExec.errorMessage}` : ""}
          </pre>
        </div>
      )}

      <div className="je-runview__section">
        <h3>Logs ({logs.length})</h3>
        <div className="je-runview__log">
          {logs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
          {logs.map(ev => {
            const line = (ev.payload as { line?: string }).line ?? JSON.stringify(ev.payload);
            return <div key={ev.id} className="je-runview__log-line">{line}</div>;
          })}
        </div>
      </div>

      <div className="je-runview__section">
        <h3>Attempts</h3>
        <div className="je-runview__attempts">
          {p.executions.length === 0 && <div style={{ color: "#666" }}>(none yet)</div>}
          {[...p.executions].sort((a, b) => a.attempt - b.attempt).map(e => (
            <div key={e.id} className="je-runview__attempt">
              <span style={{ fontWeight: 600 }}>#{e.attempt}</span>
              <span style={{ color: "#888", marginLeft: 8 }}>{e.status}</span>
              {e.errorClass && <span style={{ color: "#ff7675", marginLeft: 8 }}>{e.errorClass}</span>}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
