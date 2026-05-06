import { useQuery } from "@tanstack/react-query";
import type { CodingModel } from "@journeyman/core";
import { codingModelsApi } from "../api/codingModels.ts";

export interface CodingModelSelectProps {
  provider: string;
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  /** Label for the empty option. Default: "Use system default". */
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
}

function fmtCost(n: number | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function describeModel(m: CodingModel): string {
  const ctx = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K ctx` : "";
  const cost =
    m.inputCostPer1M != null || m.outputCostPer1M != null
      ? `${fmtCost(m.inputCostPer1M)}/${fmtCost(m.outputCostPer1M)} per 1M`
      : "";
  const dep = m.deprecated ? " [deprecated]" : "";
  const parts = [m.label, ctx, cost].filter(Boolean).join(" · ");
  return `${parts}${dep}`;
}

export function CodingModelSelect(props: CodingModelSelectProps) {
  const { provider, value, onChange, emptyLabel, disabled, id } = props;
  const { data, isLoading } = useQuery({
    queryKey: ["coding-models", provider],
    queryFn: () => codingModelsApi.list(provider),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(provider),
  });

  return (
    <select
      id={id}
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
