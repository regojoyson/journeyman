// packages/flow-editor/src/properties-panel/ExecutorBlock.tsx
import type { WorkflowDefaults, CoreExecutorKind } from "@journeyman/core";
import type { ExecutorKind } from "../phase-definition.ts";
import { executorCommonConfig, visibleProvidersFor } from "../executor-common-config.ts";
import { useFieldInheritance } from "../hooks/use-field-inheritance.ts";
import { InheritanceChip } from "./InheritanceChip.tsx";

export interface ExecutorBlockProps {
  kind: ExecutorKind;
  value: { provider?: string } | undefined | null;
  onChange: (next: { provider?: string }) => void;
  readOnly?: boolean;
  flowDefaults?: WorkflowDefaults;
}

export function ExecutorBlock({ kind, value, onChange, readOnly, flowDefaults }: ExecutorBlockProps) {
  const cfg = executorCommonConfig[kind];
  if (!cfg.provider || cfg.provider.length === 0) return null;
  const options = visibleProvidersFor(kind);
  if (options.length === 0) return null;

  const defaultProvider = flowDefaults?.executorConfig?.[kind as CoreExecutorKind]?.provider;
  const { state } = useFieldInheritance(value?.provider, defaultProvider);
  const effectiveProvider = value?.provider ?? defaultProvider ?? "";

  return (
    <div className="je-props__field">
      <div className="je-props__field-label-row">
        <label>Provider</label>
        {state === "inherited" && <InheritanceChip kind="inherited" inheritedValue={defaultProvider} />}
        {state === "override"  && (
          <InheritanceChip
            kind="override"
            onReset={() => onChange({ ...(value ?? {}), provider: undefined })}
          />
        )}
      </div>
      <select
        value={effectiveProvider}
        disabled={readOnly}
        onChange={e => onChange({ ...(value ?? {}), provider: e.target.value })}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
