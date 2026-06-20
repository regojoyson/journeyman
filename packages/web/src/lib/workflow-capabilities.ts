import type { WorkspacePermission, WorkflowStatus } from "@journeyman/core";

export interface WorkflowCapabilities {
  readOnly: boolean;
  canEdit: boolean;
  showPalette: boolean;
  canImport: boolean;
  canExport: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

export function workflowCapabilities({
  can,
  status,
}: {
  can: (perm: WorkspacePermission) => boolean;
  status: WorkflowStatus;
}): WorkflowCapabilities {
  const canWrite = can("resource.write");
  const isDraft = status === "draft";

  const readOnly = !canWrite || !isDraft;
  const canEdit = canWrite && isDraft;

  return {
    readOnly,
    canEdit,
    showPalette: canEdit,
    canImport: canEdit,
    canExport: canWrite,
    canPublish: canWrite,
    canDelete: can("resource.delete") && isDraft,
  };
}
