import { useOutletContext } from "react-router-dom";
import { WorkspaceMembersPanel } from "../../components/WorkspaceMembersPanel.tsx";
import type { WorkspaceDetailContext } from "../WorkspaceDetailPage.tsx";

export function MembersTab() {
  const { orgId, wsId } = useOutletContext<WorkspaceDetailContext>();
  return <WorkspaceMembersPanel orgId={orgId} wsId={wsId} />;
}
