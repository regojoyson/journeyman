import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { InputFieldsEditor } from "../InputFieldsEditor.tsx";
import type { SectionProps } from "./types.ts";

export function InputsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Inputs"
      description="Declared inputs are wirable in the flow editor. Reference them in the prompt with {{name}}."
    >
      <fieldset disabled={locked} className="contents">
        <InputFieldsEditor
          value={step.inputFields}
          onChange={(v) => patch({ inputFields: v })}
        />
      </fieldset>
    </SectionShell>
  );
}
