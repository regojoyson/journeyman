import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { workspaceAdminApi } from "../../api/workspaces.ts";
import { card } from "../admin-styles.ts";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function OverviewTab() {
  const { wsId, workspace } = useOutletContext<WorkspaceDetailContext>();
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void workspaceAdminApi.listMembers(wsId).then((m) => { if (active) setMemberCount(m.length); }).catch(() => {});
    return () => { active = false; };
  }, [wsId]);

  const created = new Date(workspace.createdAt).toLocaleDateString();

  return (
    <section className={`${card} p-6`}>
      <h2 className="text-base font-medium text-slate-100 mb-4">Overview</h2>
      <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
        <dt className="text-slate-500">Name</dt><dd className="text-slate-200">{workspace.name}</dd>
        <dt className="text-slate-500">Slug</dt><dd className="text-slate-200">{workspace.slug}</dd>
        <dt className="text-slate-500">Created</dt><dd className="text-slate-200">{created}</dd>
        <dt className="text-slate-500">Members</dt><dd className="text-slate-200">{memberCount ?? "…"}</dd>
      </dl>
    </section>
  );
}
