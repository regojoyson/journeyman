import React from "react";

export type ChipKind = "inherited" | "override" | "suppressed";

interface InheritanceChipProps {
  kind: ChipKind;
  onReset?: () => void;
}

const CHIP_STYLES: Record<ChipKind, React.CSSProperties> = {
  inherited:  { background: "#1a2a1a", border: "1px solid #2e4a2e", color: "#7fc480" },
  override:   { background: "#2a2010", border: "1px solid #4a3a10", color: "#fdcb6e" },
  suppressed: { background: "#2a1a1a", border: "1px solid #4a2020", color: "#e17055" },
};

const CHIP_LABELS: Record<ChipKind, string> = {
  inherited:  "FROM FLOW",
  override:   "OVERRIDE",
  suppressed: "SUPPRESSED",
};

export function InheritanceChip({ kind, onReset }: InheritanceChipProps) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
      padding: "1px 5px", borderRadius: 3,
      ...CHIP_STYLES[kind],
    }}>
      {CHIP_LABELS[kind]}
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
