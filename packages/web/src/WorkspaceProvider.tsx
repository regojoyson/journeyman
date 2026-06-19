import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspacePermission } from "@journeyman/core";
import { WorkspaceContext } from "./WorkspaceContext.tsx";
import { listMyWorkspaces, type WorkspaceSummary } from "./api/workspaces.ts";

const LS_KEY = "active-workspace-id";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listMyWorkspaces()
      .then(({ workspaces }) => {
        if (!alive) return;
        setWorkspaces(workspaces);
        const stored = localStorage.getItem(LS_KEY);
        const valid = stored && workspaces.some((w) => w.id === stored) ? stored : workspaces[0]?.id ?? "";
        setActive(valid);
      })
      .catch(() => {
        if (alive) setWorkspaces([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setActiveWorkspaceId = useCallback((id: string) => {
    localStorage.setItem(LS_KEY, id);
    setActive(id);
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const can = useCallback(
    (perm: WorkspacePermission) => activeWorkspace?.permissions.includes(perm) ?? false,
    [activeWorkspace],
  );

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, activeWorkspaceId, activeWorkspace, setActiveWorkspaceId, can, loading }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
