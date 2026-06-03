import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";

interface VisibleWorker {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  enabled: boolean;
}

export interface WorkerTabProps {
  orgId: string;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function WorkerTab({ orgId, node, onChange, readOnly }: WorkerTabProps) {
  const [workers, setWorkers] = useState<VisibleWorker[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/workers/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleWorker[]) => { if (alive) setWorkers(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setWorkers([]); });
    return () => { alive = false; };
  }, [orgId]);

  const overridden = Boolean(node.computeTargetId);
  const selected = workers.find((w) => w.id === node.computeTargetId);
  const isPerInstance = selected?.executionMode === "per-instance";

  const setWorkerId = (workerId: string | undefined) => onChange({ ...node, computeTargetId: workerId });

  return (
    <div style={{ padding: 8 }}>
      <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>Run on worker (override)</div>
      <div className="je-props__field">
        <select
          value={node.computeTargetId ?? ""}
          disabled={readOnly}
          onChange={(e) => setWorkerId(e.target.value || undefined)}
        >
          <option value="">Use workflow worker</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
          ))}
        </select>
      </div>
      {overridden && isPerInstance && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#e0a458" }}>
          ⚠ This worker has its own isolated /workspace. It won't see the clone/edits from this
          run's main worker — keep workspace-touching steps (clone/analyze/plan/implement/commit)
          on one worker.
        </div>
      )}
    </div>
  );
}
