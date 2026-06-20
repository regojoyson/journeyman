import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
import { VisibleMcpPicker, VisibleSkillPicker } from "../shared/VisibleListPickers.tsx";

export interface IntegrationsSectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function IntegrationsSection({ a, patch, locked, wsId }: IntegrationsSectionProps) {
  return (
    <SectionShell
      title="MCP & skills"
      description="Connectors and skill packages the agent loads when it runs in the sandbox. MCP connectors give the agent extra tools; skill packages add reusable instructions."
    >
      <div>
        <FieldLabel help="MCP servers the agent can call at runtime">MCP connectors</FieldLabel>
        <VisibleMcpPicker
          wsId={wsId}
          value={a.connectorMcpIds}
          onChange={(ids) => patch({ connectorMcpIds: ids })}
          disabled={locked}
        />
      </div>

      <div>
        <FieldLabel help="Skill packages loaded into the agent's context">Skill packages</FieldLabel>
        <VisibleSkillPicker
          wsId={wsId}
          value={a.skillIds}
          onChange={(ids) => patch({ skillIds: ids })}
          disabled={locked}
        />
      </div>
    </SectionShell>
  );
}
