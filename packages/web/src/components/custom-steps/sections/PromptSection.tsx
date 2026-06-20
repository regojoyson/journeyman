import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { inputCls } from "../../../routes/admin-styles.ts";
import type { SectionProps } from "./types.ts";

export function PromptSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Prompt"
      description="The instructions sent to the AI model on each run. Reference inputs with {{name}}."
    >
      <div>
        <FieldLabel>Prompt template</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[200px] font-mono text-xs`}
          disabled={locked}
          value={step.promptTemplate}
          onChange={(e) => patch({ promptTemplate: e.target.value })}
        />
      </div>
    </SectionShell>
  );
}
