import { AgentsList } from "../components/agents/AgentsList.tsx";

// Phase 3: wire a real wsId from workspace context. Placeholder used for now.
export function MyAgentsPage({ orgId, wsId }: { orgId: string; wsId: string }) {
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
