import { useQuery } from "@tanstack/react-query";
import type { CodingModel } from "@journeyman/core";
import { codingModelsApi } from "../api/codingModels.ts";
import { inputCls } from "../routes/admin-styles.ts";

export interface CodingModelSelectProps {
  provider: string;
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  /** Label for the empty option. Default: "Use system default". */
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  /** Override the default full-width styled-select class. */
  className?: string;
}

function describeModel(m: CodingModel): string {
  const ctx = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K ctx` : "";
  const dep = m.deprecated ? " [deprecated]" : "";
  const parts = [m.label, ctx].filter(Boolean).join(" · ");
  return `${parts}${dep}`;
}

export function CodingModelSelect(props: CodingModelSelectProps) {
  const { provider, value, onChange, emptyLabel, disabled, id, className } = props;
  const { data, isLoading } = useQuery({
    queryKey: ["coding-models", provider],
    queryFn: () => codingModelsApi.list(provider),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(provider),
  });

  return (
    <select
      id={id}
      className={className ?? inputCls}
      value={value ?? ""}
      disabled={disabled || isLoading}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
    >
      <option value="">{emptyLabel ?? "Use system default"}</option>
      {(data ?? []).map((m) => (
        <option key={m.id} value={m.modelId}>
          {describeModel(m)}
        </option>
      ))}
    </select>
  );
}
