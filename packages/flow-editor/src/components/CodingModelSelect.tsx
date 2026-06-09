import type { CodingModel } from "@journeyman/core";
import { useCodingModels } from "../catalogs/use-coding-models.ts";

export interface CodingModelSelectProps {
  provider: string | undefined;
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  emptyLabel?: string;
  disabled?: boolean;
}

function describeModel(m: CodingModel): string {
  const ctx = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K ctx` : "";
  const dep = m.deprecated ? " [deprecated]" : "";
  const parts = [m.label, ctx].filter(Boolean).join(" · ");
  return `${parts}${dep}`;
}

export function CodingModelSelect({
  provider,
  value,
  onChange,
  emptyLabel,
  disabled,
}: CodingModelSelectProps) {
  const models = useCodingModels(provider);
  const loading = false;

  return (
    <select
      value={value ?? ""}
      disabled={disabled || loading || !provider}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
    >
      <option value="">{emptyLabel ?? "Use system default"}</option>
      {models.map((m) => (
        <option key={m.id} value={m.modelId}>
          {describeModel(m)}
        </option>
      ))}
    </select>
  );
}
