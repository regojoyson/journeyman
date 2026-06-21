import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { PromptEditor } from "../prompt-editor/PromptEditor.tsx";
import type { SectionProps } from "./types.ts";

export function PromptSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Prompt"
      description="The instructions sent to the AI model on each run. Reference inputs with {{name}}."
    >
      <div>
        <FieldLabel>Prompt template</FieldLabel>
        <PromptEditor
          value={step.promptTemplate}
          onChange={(next) => patch({ promptTemplate: next })}
          inputFields={step.inputFields}
          slots={step.slots}
          readOnly={locked}
        />
      </div>
    </SectionShell>
  );
}
