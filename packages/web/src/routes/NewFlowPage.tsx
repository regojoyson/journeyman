import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBlankFlow } from "@journeyman/flow-editor";
import { createFlow } from "../api/flows.ts";

export function NewFlowPage() {
  const [name, setName] = useState("New flow");
  const [description, setDescription] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () => createFlow({ name, description: description || undefined, definition: createBlankFlow() }),
    onSuccess: ({ flow }) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.setQueryData(["flow-graph", flow.id], createBlankFlow());
      navigate(`/flows/${flow.id}/edit`);
    },
  });

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>New flow</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Description (optional)</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={inputStyle} />
      </div>
      <button
        disabled={!name.trim() || m.isPending}
        onClick={() => m.mutate()}
        style={{ background: "#00b894", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 5, fontWeight: 600, cursor: "pointer" }}
      >
        {m.isPending ? "Creating…" : "Create"}
      </button>
      {m.isError && <div style={{ color: "#ff7675", marginTop: 10 }}>{(m.error as Error).message}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#1f1f2c", border: "1px solid #2a2a3a",
  color: "#fff", borderRadius: 4, padding: "8px 10px", fontSize: 13, fontFamily: "inherit",
};
