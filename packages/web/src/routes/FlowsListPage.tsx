import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listFlows } from "../api/flows.ts";

export function FlowsListPage() {
  const q = useQuery({ queryKey: ["flows"], queryFn: listFlows });
  return (
    <div style={{ padding: 24, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Flows</h2>
        <div style={{ flex: 1 }} />
        <Link
          to="/flows/new"
          style={{ background: "#00b894", color: "#fff", padding: "6px 14px", borderRadius: 5, textDecoration: "none", fontSize: 13, fontWeight: 600 }}
        >+ New flow</Link>
      </div>

      {q.isLoading && <div style={{ color: "#888" }}>Loading…</div>}
      {q.isError && <div style={{ color: "#ff7675" }}>Error: {(q.error as Error).message}</div>}
      {q.data && q.data.length === 0 && (
        <div style={{ color: "#888" }}>No flows yet. Click "+ New flow" to create one.</div>
      )}
      {q.data && q.data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#888", textAlign: "left", borderBottom: "1px solid #2a2a3a" }}>
              <th style={{ padding: "8px 6px" }}>Name</th>
              <th style={{ padding: "8px 6px" }}>Description</th>
              <th style={{ padding: "8px 6px" }}>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map(f => (
              <tr key={f.id} style={{ borderBottom: "1px solid #1f1f2c" }}>
                <td style={{ padding: "10px 6px" }}>{f.name}</td>
                <td style={{ padding: "10px 6px", color: "#aaa" }}>{f.description ?? ""}</td>
                <td style={{ padding: "10px 6px", color: "#888" }}>{new Date(f.updatedAt).toLocaleString()}</td>
                <td style={{ padding: "10px 6px" }}>
                  <Link to={`/flows/${f.id}/edit`} style={{ color: "#4a9eff" }}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
