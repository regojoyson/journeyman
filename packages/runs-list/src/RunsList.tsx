import "./styles.css";
import type { RunsListProps } from "./types.ts";
import { RunFilters } from "./RunFilters.tsx";

export function RunsList(p: RunsListProps) {
  return (
    <div className="je-runslist">
      <div className="je-runslist__header">
        <h2>Runs</h2>
        <div style={{ flex: 1 }} />
        <RunFilters filter={p.filter} onChange={p.onFilterChange} />
      </div>
      {p.isLoading && <div style={{ color: "#888" }}>Loading…</div>}
      {!p.isLoading && p.runs.length === 0 && (
        <div style={{ color: "#888" }}>No runs match the current filters.</div>
      )}
      {p.runs.length > 0 && (
        <table className="je-runslist__table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Run</th>
              <th>Flow</th>
              <th>Trigger</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Failed at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.runs.map(r => (
              <tr key={r.id} onClick={() => p.onSelectRun(r.id)}>
                <td><span className={`je-runslist__pill ${r.status}`}>{r.status}</span></td>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.id.slice(0, 8)}</td>
                <td style={{ color: "#aaa" }}>{p.flowNameByVersionId?.[r.flowVersionId] ?? r.flowVersionId.slice(0, 8)}</td>
                <td style={{ color: "#aaa" }}>{r.triggerSource}</td>
                <td style={{ color: "#888" }}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                <td style={{ color: "#888" }}>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                <td style={{ color: "#ff7675" }}>{r.failedAtNodeId ?? ""}</td>
                <td onClick={e => e.stopPropagation()}>
                  {p.onRerun && r.status !== "running" && (
                    <button className="je-runslist__rerun" onClick={() => p.onRerun!(r)}>Re-run</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
