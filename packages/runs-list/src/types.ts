import type { Run } from "@journeyman/core";

export interface RunFilter {
  status?: Run["status"];
  flowId?: string;
  provider?: string;
  issueRef?: string;
}

export interface RunsListProps {
  runs: Run[];
  isLoading?: boolean;
  filter: RunFilter;
  onFilterChange: (next: RunFilter) => void;
  onSelectRun: (runId: string) => void;
  onRerun?: (run: Run) => void;
  onNewRun?: () => void;
  flowNameByVersionId?: Record<string, string>;
  scope?: "mine" | "org" | "all";
  onScopeChange?: (scope: "mine" | "org" | "all") => void;
  showOrgChip?: boolean;
  showAllChip?: boolean;
}
