import type { CSSProperties } from "react";

/**
 * Shared inline styles for every <Handle>. Inline styles beat CSS so the
 * handles are guaranteed visible regardless of how React Flow's default
 * stylesheet loads.
 */
export const handleBlue: CSSProperties = {
  width: 14,
  height: 14,
  background: "rgb(var(--color-info) / 1)",
  border: "2px solid rgb(var(--color-bg) / 1)",
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(74, 158, 255, 0.25)",
};

export const handleRed: CSSProperties = {
  width: 14,
  height: 14,
  background: "rgb(var(--color-danger) / 1)",
  border: "2px solid rgb(var(--color-bg) / 1)",
  borderRadius: "50%",
  boxShadow: "0 0 0 2px rgba(255, 118, 117, 0.25)",
};
