import React from "react";

export type ChipKind = "inherited" | "override" | "suppressed";

interface InheritanceChipProps {
  kind: ChipKind;
  onReset?: () => void;
  inheritedValue?: unknown;
}

const CHIP_STYLES: Record<ChipKind, React.CSSProperties> = {
  inherited:  { background: "#1a2a1a", border: "1px solid #2e4a2e", color: "#7fc480" },
  override:   { background: "#2a2010", border: "1px solid #4a3a10", color: "#fdcb6e" },
  suppressed: { background: "#2a1a1a", border: "1px solid #4a2020", color: "#e17055" },
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

export function InheritanceChip({ kind, onReset, inheritedValue }: InheritanceChipProps) {
  const valueStr = kind === "inherited" && inheritedValue !== undefined ? formatValue(inheritedValue) : "";
  const tooltip =
    kind === "inherited"
      ? "Value comes from flow defaults. Edit to customize for this step."
      : kind === "override"
      ? "This step uses its own value. Click ↺ to go back to flow default."
      : undefined;

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
        padding: "1px 5px", borderRadius: 3,
        cursor: tooltip ? "help" : undefined,
        ...CHIP_STYLES[kind],
      }}
    >
      {kind === "inherited" && valueStr ? `FROM FLOW: ${valueStr}` : kind === "inherited" ? "FROM FLOW" : kind === "suppressed" ? "SUPPRESSED" : "OVERRIDE"}
      {kind === "override" && onReset && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to flow default"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "inherit", padding: 0, fontSize: 10, lineHeight: 1,
          }}
        >↺</button>
      )}
    </span>
  );
}
