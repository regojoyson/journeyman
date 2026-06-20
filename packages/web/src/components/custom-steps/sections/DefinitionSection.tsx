import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { inputCls } from "../../../routes/admin-styles.ts";
import { IconPicker } from "../IconPicker.tsx";
import type { SectionProps } from "./types.ts";

export function DefinitionSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Definition"
      description="How this step identifies itself in the workflow editor palette."
    >
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          value={step.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Summarize PR"
        />
      </div>
      <div>
        <FieldLabel>Description</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[80px]`}
          disabled={locked}
          value={step.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="What this step does, and when a flow author would reach for it."
        />
      </div>
      <div>
        <FieldLabel>Icon</FieldLabel>
        {locked ? (
          <div className="text-sm text-muted-foreground">{step.icon ?? "Default"}</div>
        ) : (
          <IconPicker value={step.icon ?? null} onChange={(v) => patch({ icon: v })} />
        )}
      </div>
    </SectionShell>
  );
}
