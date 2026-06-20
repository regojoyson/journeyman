import type { Agent, AgentUpdateInput, CanonicalTool } from "@journeyman/core";
import { ToolsPicker } from "../../custom-steps/ToolsPicker.tsx";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function PermissionsSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Permissions" description="Which tools the agent is allowed to use.">
      <div>
        <FieldLabel>Allowed tools</FieldLabel>
        <ToolsPicker
          value={a.permissions.allowedTools}
          onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })}
          disabled={locked}
        />
      </div>
    </SectionShell>
  );
}
