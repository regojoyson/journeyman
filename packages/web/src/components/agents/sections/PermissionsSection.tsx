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
    <SectionShell title="Permissions" description="Restrict which tools the agent can call. A read-only agent can't accidentally push code. Workspace tools (bash, file read/write) require a repository to be configured in Workspace.">
      <div>
        <FieldLabel help="File system, bash, and web tools the agent may call">Allowed tools</FieldLabel>
        <ToolsPicker
          value={a.permissions.allowedTools}
          onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })}
          disabled={locked}
        />
      </div>
    </SectionShell>
  );
}
