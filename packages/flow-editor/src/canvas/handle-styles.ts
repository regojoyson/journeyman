import type { CSSProperties } from "react";

/**
 * Shared inline styles for every <Handle>. Inline styles beat CSS so the
 * handles are guaranteed visible regardless of how React Flow's default
 * stylesheet loads.
 */
export const handleBlue: CSSProperties = {
  width: 14,
  height: 14,
  background: "#4a9eff",
  border: "2px solid #11111a",
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(74, 158, 255, 0.25)",
};

export const handleRed: CSSProperties = {
  width: 14,
  height: 14,
  background: "#ff7675",
  border: "2px solid #11111a",
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(255, 118, 117, 0.25)",
};
