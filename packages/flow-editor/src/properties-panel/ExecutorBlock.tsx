// packages/flow-editor/src/properties-panel/ExecutorBlock.tsx
import type { ExecutorKind } from "../phase-definition.ts";
import { executorCommonConfig } from "../executor-common-config.ts";

export interface ExecutorBlockProps {
  kind: ExecutorKind;
  value: { provider?: string } | undefined;
  onChange: (next: { provider?: string }) => void;
  readOnly?: boolean;
}

export function ExecutorBlock({ kind, value, onChange, readOnly }: ExecutorBlockProps) {
  const cfg = executorCommonConfig[kind];
  if (!cfg.provider || cfg.provider.length === 0) return null;

  return (
    <div className="je-props__field">
      <label>Provider</label>
      <select
        value={value?.provider ?? ""}
        disabled={readOnly}
        onChange={e => onChange({ ...(value ?? {}), provider: e.target.value })}
      >
        {cfg.provider.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
