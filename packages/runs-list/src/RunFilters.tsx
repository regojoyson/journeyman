import type { WorkflowInstanceFilter } from "./types.ts";
import type { WorkflowInstance } from "@journeyman/core";

const STATUSES: WorkflowInstance["status"][] = ["pending", "running", "completed", "failed", "cancelled", "paused"];
const PROVIDERS = ["jira", "github", "monday", "linear", "manual", "api"];

export interface WorkflowInstanceFiltersProps {
  filter: WorkflowInstanceFilter;
  onChange: (next: WorkflowInstanceFilter) => void;
}

export function WorkflowInstanceFilters({ filter, onChange }: WorkflowInstanceFiltersProps) {
  return (
    <div className="je-runslist__filters">
      <select
        value={filter.status ?? ""}
        onChange={e => onChange({ ...filter, status: (e.target.value || undefined) as WorkflowInstance["status"] | undefined })}
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select
        value={filter.provider ?? ""}
        onChange={e => onChange({ ...filter, provider: e.target.value || undefined })}
      >
        <option value="">All providers</option>
        {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      <input
        type="text"
        value={filter.issueRef ?? ""}
        onChange={e => onChange({ ...filter, issueRef: e.target.value || undefined })}
        placeholder="Issue ref e.g. jira:PROJ-123"
        style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #2a2a3e", background: "#0f0f1e", color: "#fff", fontSize: 12 }}
      />
    </div>
  );
}
