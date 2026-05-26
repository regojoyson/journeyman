import type { WorkflowInstanceFilter } from "./types.ts";
import type { WorkflowInstance } from "@journeyman/core";

const STATUSES: WorkflowInstance["status"][] = ["pending", "running", "completed", "failed", "cancelled", "paused"];

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
    </div>
  );
}
