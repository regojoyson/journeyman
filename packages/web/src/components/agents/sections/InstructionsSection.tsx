import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function InstructionsSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Instructions & Inputs" description="What this agent should do each run.">
      <div>
        <FieldLabel>Instructions</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[160px]`}
          disabled={locked}
          value={a.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </div>
      <div className="text-xs text-muted-foreground bg-muted rounded-md p-3">
        Insert an input with <code className={codePill}>{"{{name}}"}</code>. Available:{" "}
        {a.inputs.map((i) => `{{${i.name}}}`).join(" · ") || "—"}, <code className={codePill}>{"{{payload}}"}</code>,{" "}
        <code className={codePill}>{"{{trigger.type}}"}</code>.
      </div>
    </SectionShell>
  );
}
