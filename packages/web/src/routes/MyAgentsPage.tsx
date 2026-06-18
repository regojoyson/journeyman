import { AgentsList } from "../components/agents/AgentsList.tsx";

export function MyAgentsPage({ orgId }: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">My Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Autonomous agents you own.</p>
        </header>
        <AgentsList orgId={orgId} scope="user" />
      </div>
    </div>
  );
}
