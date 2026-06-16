import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";

interface VisibleSandbox {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  enabled: boolean;
}

export interface SandboxTabProps {
  orgId: string;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function SandboxTab({ orgId, node, onChange, readOnly }: SandboxTabProps) {
  const [workers, setSandboxes] = useState<VisibleSandbox[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/sandboxes/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSandbox[]) => { if (alive) setSandboxes(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setSandboxes([]); });
    return () => { alive = false; };
  }, [orgId]);

  const overridden = Boolean(node.sandboxId);
  const selected = workers.find((w) => w.id === node.sandboxId);
  const isPerInstance = selected?.executionMode === "per-instance";

  const setSandboxId = (workerId: string | undefined) => onChange({ ...node, sandboxId: workerId });

  return (
    <div style={{ padding: 8 }}>
      <div style={{ color: "rgb(var(--color-text) / 1)", fontSize: 12, marginBottom: 6 }}>Run on sandbox (override)</div>
      <div className="je-props__field">
        <select
          value={node.sandboxId ?? ""}
          disabled={readOnly}
          onChange={(e) => setSandboxId(e.target.value || undefined)}
        >
          <option value="">Use workflow sandbox</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
          ))}
        </select>
      </div>
      {overridden && isPerInstance && (
        <div style={{ marginTop: 6, fontSize: 11, color: "rgb(var(--color-warning) / 1)" }}>
          ⚠ This worker has its own isolated /workspace. It won't see the clone/edits from this
          run's main worker — keep workspace-touching steps (clone/analyze/plan/implement/commit)
          on one worker.
        </div>
      )}
    </div>
  );
}
