import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { OutputSchemaEditor } from "../OutputSchemaEditor.tsx";
import type { SectionProps } from "./types.ts";

export function OutputSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Output"
      description="Structured output is validated against your JSON schema by the model SDK."
    >
      <fieldset disabled={locked} className="contents">
        <OutputSchemaEditor
          mode={step.outputMode}
          fields={step.outputFields ?? []}
          onModeChange={(v) => patch({ outputMode: v })}
          onFieldsChange={(v) => patch({ outputFields: v })}
        />
      </fieldset>
    </SectionShell>
  );
}
