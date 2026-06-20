import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { SecretsEditor } from "../SecretsEditor.tsx";
import type { SectionProps } from "./types.ts";

export function SecretsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Secrets"
      description="Credential slots this step needs at runtime. Flow authors bind each slot per node."
    >
      <fieldset disabled={locked} className="contents">
        <SecretsEditor
          value={step.slots}
          onChange={(v) => patch({ slots: v })}
          hasBashTool={step.defaultTools.includes("bash")}
        />
      </fieldset>
    </SectionShell>
  );
}
