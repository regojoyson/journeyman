import { useEffect, useState } from "react";
import type { CodingModel } from "@journeyman/core";

export interface CodingModelSelectProps {
  provider: string | undefined;
  value: string | undefined;
  onChange: (modelId: string | undefined) => void;
  emptyLabel?: string;
  disabled?: boolean;
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

export function CodingModelSelect({
  provider,
  value,
  onChange,
  emptyLabel,
  disabled,
}: CodingModelSelectProps) {
  const [models, setModels] = useState<CodingModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CodingModel[]) => { if (alive) setModels(rows); })
      .catch(() => { if (alive) setModels([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [provider]);

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
