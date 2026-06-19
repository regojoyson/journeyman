import { createContext, useContext } from "react";
import type { WorkspacePermission } from "@journeyman/core";
import type { WorkspaceSummary } from "./api/workspaces.ts";

export interface WorkspaceCtx {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string; // "" until resolved
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspaceId: (id: string) => void;
  can: (perm: WorkspacePermission) => boolean; // against active workspace
  loading: boolean;
}

export const WorkspaceContext = createContext<WorkspaceCtx>({
  workspaces: [],
  activeWorkspaceId: "",
  activeWorkspace: null,
  setActiveWorkspaceId: () => {},
  can: () => false,
  loading: true,
});

export function useWorkspace(): WorkspaceCtx {
  return useContext(WorkspaceContext);
}
