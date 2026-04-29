import { useEffect } from "react";

export interface StatusToastProps {
  kind: "success" | "error";
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss after N ms. Default 3000 for success, 6000 for error. */
  autoDismissMs?: number;
}

export function StatusToast({ kind, message, onDismiss, autoDismissMs }: StatusToastProps) {
  const ms = autoDismissMs ?? (kind === "success" ? 3000 : 6000);
  useEffect(() => {
    if (ms <= 0) return;
    const id = setTimeout(onDismiss, ms);
    return () => clearTimeout(id);
  }, [ms, onDismiss]);

  const accent = kind === "success" ? "#00b894" : "#ff7675";
  const title = kind === "success" ? "Saved" : "Save failed";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", bottom: 20, right: 20, background: "#1f1f2c",
        border: `1px solid ${accent}`, borderRadius: 6, padding: "6px 10px",
        color: "#fff", fontSize: 12, maxWidth: 320, zIndex: 100,
        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", gap: 8, lineHeight: 1.3,
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0,
      }} />
      <span style={{ fontWeight: 600 }}>{title}:</span>
      <span style={{ color: "#bbb", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {message}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: "transparent", border: "none", color: "#888",
          cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2,
        }}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}
