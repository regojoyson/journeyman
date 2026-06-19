import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
import { detectInputs } from "../detect-inputs.ts";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function InstructionsSection({ a, patch, locked }: SectionProps) {
  const onChangeInstructions = (text: string) => {
    const names = detectInputs(text);
    patch({
      instructions: text,
      inputs: names.map((name) => ({ name, type: "text", required: false })),
    });
  };
  const detected = a.inputs.map((i) => i.name);

  return (
    <SectionShell title="Instructions & Inputs" description="What this agent should do each run.">
      <div>
        <FieldLabel>Instructions</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[160px]`}
          disabled={locked}
          value={a.instructions}
          onChange={(e) => onChangeInstructions(e.target.value)}
        />
      </div>
      <div className="text-xs text-muted-foreground bg-muted rounded-md p-3 space-y-2">
        <div>
          Insert a value with <code className={codePill}>{"{{name}}"}</code>. Reserved:{" "}
          <code className={codePill}>{"{{payload}}"}</code>, <code className={codePill}>{"{{trigger.type}}"}</code>.
        </div>
        <div>
          <span className="font-medium text-foreground">Detected inputs:</span>{" "}
          {detected.length === 0 ? (
            "—"
          ) : (
            detected.map((name) => (
              <span key={name} className={`${codePill} mr-1`}>
                {name}
              </span>
            ))
          )}
        </div>
      </div>
    </SectionShell>
  );
}
