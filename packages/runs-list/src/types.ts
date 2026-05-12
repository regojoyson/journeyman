import type { WorkflowInstance } from "@journeyman/core";

export interface WorkflowInstanceFilter {
  status?: WorkflowInstance["status"];
  workflowId?: string;
  provider?: string;
  issueRef?: string;
}

export interface WorkflowInstancesListProps {
  workflowInstances: WorkflowInstance[];
  isLoading?: boolean;
  filter: WorkflowInstanceFilter;
  onFilterChange: (next: WorkflowInstanceFilter) => void;
  onSelectWorkflowInstance: (workflowInstanceId: string) => void;
  onRerun?: (workflowInstance: WorkflowInstance) => void;
  onNewWorkflowInstance?: () => void;
  workflowNameByVersionId?: Record<string, string>;
  scope?: "mine" | "org" | "all";
  onScopeChange?: (scope: "mine" | "org" | "all") => void;
  showOrgChip?: boolean;
  showAllChip?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
  };
}
