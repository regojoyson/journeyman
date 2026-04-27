import type { RunFilter } from "./types.ts";
import type { Run } from "@journeyman/core";

const STATUSES: Run["status"][] = ["pending", "running", "completed", "failed", "cancelled", "paused"];

export interface RunFiltersProps {
  filter: RunFilter;
  onChange: (next: RunFilter) => void;
}

export function RunFilters({ filter, onChange }: RunFiltersProps) {
  return (
    <div className="je-runslist__filters">
      <select
        value={filter.status ?? ""}
        onChange={e => onChange({ ...filter, status: (e.target.value || undefined) as Run["status"] | undefined })}
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
