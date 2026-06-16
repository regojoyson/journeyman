import { conductorUiUrl } from "../api/client.ts";

export interface RunSubmittedToastProps {
  workflowInstanceId: string;
  engineWorkflowId: string;
  onDismiss: () => void;
  onViewLive?: () => void;
}

export function RunSubmittedToast(p: RunSubmittedToastProps) {
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, background: "rgb(var(--color-surface) / 1)",
      border: "1px solid rgb(var(--color-success) / 1)", borderRadius: 8, padding: 14,
      color: "rgb(var(--color-text) / 1)", fontSize: 13, maxWidth: 360, zIndex: 100,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Workflow instance submitted</div>
      <div style={{ color: "rgb(var(--color-text-muted) / 1)", marginBottom: 4 }}>
        Instance id: <span style={{ color: "rgb(var(--color-text) / 1)", fontFamily: "ui-monospace, monospace" }}>{p.workflowInstanceId}</span>
      </div>
      <div style={{ color: "rgb(var(--color-text-muted) / 1)", marginBottom: 8 }}>
        Workflow: <a
          href={`${conductorUiUrl}/execution/${p.engineWorkflowId}`}
          target="_blank" rel="noreferrer"
          style={{ color: "rgb(var(--color-info) / 1)" }}
        >open in Conductor UI</a>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {p.onViewLive && (
          <button
            onClick={p.onViewLive}
            style={{ background: "rgb(var(--color-success) / 1)", border: "none", color: "#fff" /* theme-colors-allow: white-on-success */, padding: "5px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
          >View live →</button>
        )}
        <button
          style={{ background: "rgb(var(--color-surface-raised) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          onClick={p.onDismiss}
        >Dismiss</button>
      </div>
    </div>
  );
}
