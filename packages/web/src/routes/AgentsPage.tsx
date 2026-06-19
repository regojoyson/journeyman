import { useParams } from "react-router-dom";
import { AgentsList } from "../components/agents/AgentsList.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";

export function AgentsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { workspaces, activeWorkspace } = useWorkspace();
  const orgId =
    workspaces.find((w) => w.id === wsId)?.orgId ?? activeWorkspace?.orgId ?? "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Autonomous agents in this workspace.</p>
        </header>
        <AgentsList orgId={orgId} wsId={wsId} />
      </div>
    </div>
  );
}
