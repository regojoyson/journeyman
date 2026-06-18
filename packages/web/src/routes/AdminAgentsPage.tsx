import { AgentsList } from "../components/agents/AgentsList.tsx";
import { OrgAgentSettingsPanel } from "../components/agents/OrgAgentSettingsPanel.tsx";
import { AuditLogPanel } from "../components/agents/AuditLogPanel.tsx";

export function AdminAgentsPage({ orgId }: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">Org Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Agents shared with the org.</p>
        </header>
        <OrgAgentSettingsPanel orgId={orgId} />
        <AgentsList orgId={orgId} scope="org" />
        <AuditLogPanel orgId={orgId} />
      </div>
    </div>
  );
}
