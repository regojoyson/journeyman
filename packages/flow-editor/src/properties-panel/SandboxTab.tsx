import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";

interface VisibleComputeTarget {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  enabled: boolean;
}

export interface ComputeTargetTabProps {
  orgId: string;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function ComputeTargetTab({ orgId, node, onChange, readOnly }: ComputeTargetTabProps) {
  const [workers, setComputeTargets] = useState<VisibleComputeTarget[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/compute-targets/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleComputeTarget[]) => { if (alive) setComputeTargets(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setComputeTargets([]); });
    return () => { alive = false; };
  }, [orgId]);

  const overridden = Boolean(node.computeTargetId);
  const selected = workers.find((w) => w.id === node.computeTargetId);
  const isPerInstance = selected?.executionMode === "per-instance";

  const setComputeTargetId = (workerId: string | undefined) => onChange({ ...node, computeTargetId: workerId });

  return (
    <div style={{ padding: 8 }}>
      <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>Run on compute target (override)</div>
      <div className="je-props__field">
        <select
          value={node.computeTargetId ?? ""}
          disabled={readOnly}
          onChange={(e) => setComputeTargetId(e.target.value || undefined)}
        >
          <option value="">Use workflow compute target</option>
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
