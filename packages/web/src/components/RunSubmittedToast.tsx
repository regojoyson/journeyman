import { conductorUiUrl } from "../api/client.ts";

export interface RunSubmittedToastProps {
  runId: string;
  engineWorkflowId: string;
  onDismiss: () => void;
  onViewLive?: () => void;
}

export function RunSubmittedToast(p: RunSubmittedToastProps) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, background: "#1f1f2c",
      border: "1px solid #00b894", borderRadius: 8, padding: 14,
      color: "#fff", fontSize: 13, maxWidth: 360, zIndex: 100,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Run submitted</div>
      <div style={{ color: "#aaa", marginBottom: 4 }}>
        Run id: <span style={{ color: "#fff", fontFamily: "ui-monospace, monospace" }}>{p.runId}</span>
      </div>
      <div style={{ color: "#aaa", marginBottom: 8 }}>
        Workflow: <a
          href={`${conductorUiUrl}/execution/${p.engineWorkflowId}`}
          target="_blank" rel="noreferrer"
          style={{ color: "#4a9eff" }}
        >open in Conductor UI</a>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {p.onViewLive && (
          <button
            onClick={p.onViewLive}
            style={{ background: "#00b894", border: "none", color: "#fff", padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
          >View live →</button>
        )}
        <button
          style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          onClick={p.onDismiss}
        >Dismiss</button>
      </div>
    </div>
  );
}
