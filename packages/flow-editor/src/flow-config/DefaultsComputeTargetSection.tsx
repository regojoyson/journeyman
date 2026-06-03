import { useEffect, useState } from "react";
import type { WorkflowDefaults } from "@journeyman/core";
import { useOrgId } from "../state/org-context.tsx";

interface VisibleComputeTarget {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  scope: string;
  enabled: boolean;
}

interface Props {
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsComputeTargetSection({ defaults, onChange, readOnly }: Props) {
  const orgId = useOrgId();
  const [workers, setComputeTargets] = useState<VisibleComputeTarget[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/compute-targets/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleComputeTarget[]) => { if (alive) setComputeTargets(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setComputeTargets([]); });
    return () => { alive = false; };
  }, [orgId]);

  const setComputeTargetId = (workerId: string | undefined) => onChange({ ...defaults, computeTargetId: workerId });

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>ComputeTarget (where this workflow runs)</div>
      <div className="je-props__field">
        <select
          value={defaults.computeTargetId ?? ""}
          disabled={readOnly}
          onChange={(e) => setComputeTargetId(e.target.value || undefined)}
        >
          <option value="">Default (system Local Workspace)</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
          ))}
        </select>
      </div>
      <div className="je-props__field-help" style={{ marginTop: 4 }}>
        Steps that don't override use this compute target. Leave as Default to run in-process.
      </div>
    </div>
  );
}
