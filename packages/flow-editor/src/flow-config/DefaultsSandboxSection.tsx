import { useEffect, useState } from "react";
import type { WorkflowDefaults } from "@journeyman/core";
import { useOrgId } from "../state/org-context.tsx";

interface VisibleSandbox {
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

export function DefaultsSandboxSection({ defaults, onChange, readOnly }: Props) {
  const orgId = useOrgId();
  const [workers, setSandboxes] = useState<VisibleSandbox[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/sandboxes/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSandbox[]) => { if (alive) setSandboxes(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setSandboxes([]); });
    return () => { alive = false; };
  }, [orgId]);

  const setSandboxId = (workerId: string | undefined) => onChange({ ...defaults, sandboxId: workerId });

  return (
    <div style={{ borderTop: "1px solid rgb(var(--color-surface-raised) / 1)", paddingTop: 8, marginTop: 8 }}>
      <div style={{ color: "rgb(var(--color-text) / 1)", fontSize: 12, marginBottom: 6 }}>Sandbox (where this workflow runs)</div>
      <div className="je-props__field">
        <select
          value={defaults.sandboxId ?? ""}
          disabled={readOnly}
          onChange={(e) => setSandboxId(e.target.value || undefined)}
        >
          <option value="" disabled>— Select a sandbox —</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
          ))}
        </select>
      </div>
      {!defaults.sandboxId && (
        <div className="je-props__field-help" style={{ marginTop: 4, color: "rgb(var(--color-danger) / 1)" }}>
          Required — pick where this workflow runs. Publishing is blocked until you choose one.
        </div>
      )}
      <div className="je-props__field-help" style={{ marginTop: 4 }}>
        Every step runs on this sandbox. (Per-step overrides are coming later.)
      </div>
    </div>
  );
}
