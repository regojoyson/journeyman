import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Flow } from "@journeyman/core";
import { listFlows } from "../api/flows.ts";
import { cloneFlow, promoteFlow, deleteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";

function canEditFlow(
  flow: Flow,
  ctx: { userId: string; orgId: string; role: string; isPlatformAdmin: boolean },
): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (flow.scope === "global") return false;
  if (flow.scope === "org") return ctx.role === "admin" && flow.orgId === ctx.orgId;
  /* user */ return flow.ownerUserId === ctx.userId;
}

export function FlowsListPage() {
  const navigate = useNavigate();
  const { user, activeOrgId, role, isPlatformAdmin } = useAuth();

  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "org" | "global">("all");

  async function fetchFlows(scope: typeof scopeFilter) {
    setLoading(true);
    setError(null);
    try {
      const data = await listFlows(scope === "all" ? undefined : { scope });
      setFlows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchFlows(scopeFilter);
  }, [scopeFilter]);

  const ctx = {
    userId: user?.id ?? "",
    orgId: activeOrgId,
    role,
    isPlatformAdmin,
  };

  async function handleClone(flow: Flow) {
    try {
      const { id } = await cloneFlow(flow.id);
      navigate(`/flows/${id}/edit`);
    } catch (e) {
      alert(`Clone failed: ${(e as Error).message}`);
    }
  }

  async function handlePromote(flow: Flow, targetScope: "org" | "global") {
    try {
      await promoteFlow(flow.id, { targetScope });
      await fetchFlows(scopeFilter);
    } catch (e) {
      alert(`Promote failed: ${(e as Error).message}`);
    }
  }

  async function handleDelete(flow: Flow) {
    if (!window.confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    try {
      await deleteFlow(flow.id);
      await fetchFlows(scopeFilter);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

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

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["all", "user", "org", "global"] as const).map(s => (
          <button
            key={s}
            onClick={() => setScopeFilter(s)}
            style={{
              padding: "4px 10px",
              background: scopeFilter === s ? "#222" : "#eee",
              color: scopeFilter === s ? "#fff" : "#222",
              borderRadius: 4, border: "none",
              cursor: "pointer",
            }}
          >
            {s === "user" ? "Mine" : s === "org" ? "Organization" : s === "global" ? "Global" : "All"}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: "#888" }}>Loading…</div>}
      {error && <div style={{ color: "#ff7675" }}>Error: {error}</div>}
      {!loading && !error && flows.length === 0 && (
        <div style={{ color: "#888" }}>No flows yet. Click "+ New flow" to create one.</div>
      )}
      {!loading && !error && flows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#888", textAlign: "left", borderBottom: "1px solid #2a2a3a" }}>
              <th style={{ padding: "8px 6px" }}>Name</th>
              <th style={{ padding: "8px 6px" }}>Description</th>
              <th style={{ padding: "8px 6px" }}>Updated</th>
              <th style={{ padding: "8px 6px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {flows.map(f => {
              const editable = canEditFlow(f, ctx);
              return (
                <tr key={f.id} style={{ borderBottom: "1px solid #1f1f2c" }}>
                  <td style={{ padding: "10px 6px" }}>
                    {f.name}
                    <span style={{
                      fontSize: 11, padding: "1px 6px", marginLeft: 8,
                      background: f.scope === "global" ? "#7c3aed" : f.scope === "org" ? "#2563eb" : "#6b7280",
                      color: "#fff", borderRadius: 3,
                    }}>{f.scope}</span>
                  </td>
                  <td style={{ padding: "10px 6px", color: "#aaa" }}>{f.description ?? ""}</td>
                  <td style={{ padding: "10px 6px", color: "#888" }}>{new Date(f.updatedAt).toLocaleString()}</td>
                  <td style={{ padding: "10px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {editable ? (
                      <>
                        <Link to={`/flows/${f.id}/edit`} style={{ color: "#4a9eff" }}>Edit</Link>
                        <button
                          onClick={() => handleClone(f)}
                          style={{ color: "#4a9eff", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                        >Clone</button>
                        <button
                          onClick={() => handleDelete(f)}
                          style={{ color: "#ff7675", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                        >Delete</button>
                        {f.scope === "user" && (
                          <button
                            onClick={() => handlePromote(f, "org")}
                            style={{ color: "#f59e0b", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                          >Promote → Org</button>
                        )}
                        {(f.scope === "org" || f.scope === "user") && (
                          <button
                            onClick={() => handlePromote(f, "global")}
                            style={{ color: "#7c3aed", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                          >Promote → Global</button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleClone(f)}
                          style={{ color: "#4a9eff", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}
                        >Clone to my flows</button>
                        <Link to={`/flows/${f.id}/edit`} style={{ color: "#888" }}>Open (read-only)</Link>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
