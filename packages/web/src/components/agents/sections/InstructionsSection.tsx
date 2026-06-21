import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { codePill } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
import { PromptEditor } from "../../custom-steps/prompt-editor/PromptEditor.tsx";
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
    <SectionShell title="Instructions & Inputs" description="Describe what this agent should do on each run. Be specific — the more context you give, the better the results.">
      <div>
        <FieldLabel>Instructions</FieldLabel>
        <PromptEditor
          value={a.instructions}
          onChange={onChangeInstructions}
          inputFields={a.inputs.map((i) => ({ name: i.name, type: "string", required: false }))}
          slots={[]}
          readOnly={locked}
          hideSidebar
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
