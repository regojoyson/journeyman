import type { JSX } from "react";
import type { WorkflowDefaults } from "@journeyman/core";
import { DefaultsExecutorSection } from "../../flow-config/DefaultsExecutorSection.tsx";
import { DefaultsModelSection } from "../../flow-config/DefaultsModelSection.tsx";
import { DefaultsSandboxSection } from "../../flow-config/DefaultsSandboxSection.tsx";
import { DefaultsRetrySection } from "../../flow-config/DefaultsRetrySection.tsx";

export interface ConfigStepProps {
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function ConfigStep({ defaults, onChange, readOnly }: ConfigStepProps): JSX.Element {
  return (
    <div className="je-wizard__config">
      <p className="je-wizard__hint">
        These values are inherited by every step. Each step can override any field later on the canvas.
      </p>
      <DefaultsExecutorSection defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsModelSection    defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsSandboxSection  defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsRetrySection    defaults={defaults} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
