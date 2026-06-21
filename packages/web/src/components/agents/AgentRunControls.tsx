import { isTerminalStatus, type WorkflowInstanceStatus } from "@journeyman/core";
import { btnSecondary, btnDangerOutline } from "../../routes/admin-styles.ts";

export interface AgentRunControlsProps {
  status: WorkflowInstanceStatus;
  busy: boolean;
  canWrite: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRerun: () => void;
}

export function AgentRunControls(p: AgentRunControlsProps) {
  if (!p.canWrite) return null;

  const terminal = isTerminalStatus(p.status);
  const running = p.status === "running";
  const paused = p.status === "paused";

  return (
    <div className="flex items-center gap-2">
      {running && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onPause}>
          ⏸ Pause
        </button>
      )}
      {paused && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onResume}>
          ▶ Resume
        </button>
      )}
      {!terminal && (
        <button className={btnDangerOutline} disabled={p.busy} onClick={p.onCancel}>
          ⏹ Cancel
        </button>
      )}
      {terminal && (
        <button className={btnSecondary} disabled={p.busy} onClick={p.onRerun}>
          ↻ Re-run
        </button>
      )}
    </div>
  );
}
