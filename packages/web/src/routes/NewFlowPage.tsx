import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createBlankFlow } from "@journeyman/flow-editor";
import type { WorkflowGraph } from "@journeyman/core";
import { createFlow } from "../api/flows.ts";
import { useAuth } from "../AuthContext.tsx";

type Source = "blank" | "upload";

function parseFlowJson(text: string): WorkflowGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("Expected a JSON object at the root.");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) throw new Error("Missing or invalid 'nodes' array.");
  if (!Array.isArray(obj.edges)) throw new Error("Missing or invalid 'edges' array.");
  if (typeof obj.schemaVersion !== "string" && typeof obj.schemaVersion !== "number") {
    throw new Error("Missing 'schemaVersion'.");
  }
  return obj as unknown as WorkflowGraph;
}

export function NewFlowPage() {
  const [name, setName] = useState("New flow");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"user" | "org" | "global">("user");
  const [source, setSource] = useState<Source>("blank");
  const [uploaded, setUploaded] = useState<WorkflowGraph | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role, isPlatformAdmin } = useAuth();

  const allowed: ("user" | "org" | "global")[] = [
    "user",
    ...(role === "admin" || isPlatformAdmin ? ["org"] as const : []),
    ...(isPlatformAdmin ? ["global"] as const : []),
  ];

  const m = useMutation({
    mutationFn: () => {
      const definition = source === "upload" && uploaded ? uploaded : createBlankFlow();
      return createFlow({ scope, name, description: description || undefined, definition });
    },
    onSuccess: ({ workflow }, _vars) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      const definition = source === "upload" && uploaded ? uploaded : createBlankFlow();
      qc.setQueryData(["flow-graph", workflow.id], definition);
      navigate(`/workflows/${workflow.id}/edit`);
    },
  });

  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploadedFilename(file.name);
    try {
      const text = await file.text();
      const flow = parseFlowJson(text);
      setUploaded(flow);
    } catch (e) {
      setUploaded(null);
      setUploadError((e as Error).message);
    }
  };

  const canCreate = !!name.trim() && !m.isPending && (source === "blank" || !!uploaded);

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h2 style={{ fontSize: 18, marginTop: 0 }}>New flow</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Description (optional)</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={inputStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 4, textTransform: "uppercase" }}>Scope</label>
        <select value={scope} onChange={e => setScope(e.target.value as any)} style={inputStyle}>
          {allowed.map(s => (
            <option key={s} value={s} style={{ background: "#1f1f2c", color: "#fff" }}>
              {s === "user" ? "Personal (only me)" : s === "org" ? "Organization" : "Global (all orgs)"}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", color: "#aaa", fontSize: 11, marginBottom: 6, textTransform: "uppercase" }}>Start from</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setSource("blank")}
            style={sourceTabStyle(source === "blank")}
          >Blank</button>
          <button
            type="button"
            onClick={() => setSource("upload")}
            style={sourceTabStyle(source === "upload")}
          >Upload JSON</button>
        </div>
        {source === "upload" && (
          <div style={{ marginTop: 10 }}>
            <label style={{ ...inputStyle, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", width: "auto" }}>
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              Choose file…
            </label>
            {uploadedFilename && !uploadError && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#bbb" }}>
                Loaded <code>{uploadedFilename}</code>
                {uploaded && ` — ${uploaded.nodes.length} nodes, ${uploaded.edges.length} edges`}
              </div>
            )}
            {uploadError && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#ff7675" }}>{uploadError}</div>
            )}
          </div>
        )}
      </div>
      <button
        disabled={!canCreate}
        onClick={() => m.mutate()}
        style={{
          background: "#00b894", border: "none", color: "#fff", padding: "8px 16px",
          borderRadius: 5, fontWeight: 600, cursor: canCreate ? "pointer" : "not-allowed",
          opacity: canCreate ? 1 : 0.5,
        }}
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

function sourceTabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#2a2a3e" : "#1a1a24",
    border: `1px solid ${active ? "#4a4a5e" : "#2a2a3a"}`,
    color: active ? "#fff" : "#aaa",
    borderRadius: 5,
    padding: "7px 14px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
