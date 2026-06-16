import { useEffect, useRef } from "react";

export interface PanelResizerProps {
  /** Current width in pixels of the panel being resized. */
  width: number;
  /** Called as the user drags. */
  onResize: (next: number) => void;
  /** Min width in px. Default 220. */
  min?: number;
  /** Max width in px. Default 720. */
  max?: number;
  /**
   * Direction of the panel relative to the resizer:
   *   "right" → user is resizing a right-side panel; dragging LEFT makes it wider.
   *   "left"  → user is resizing a left-side panel; dragging RIGHT makes it wider.
   */
  side: "left" | "right";
}

export function PanelResizer({ width, onResize, min = 220, max = 720, side }: PanelResizerProps) {
  const draggingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - draggingRef.current.startX;
      const delta = side === "right" ? -dx : dx;
      const next = Math.min(max, Math.max(min, draggingRef.current.startWidth + delta));
      onResize(next);
    };
    const onUp = () => {
      draggingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize, min, max, side]);

  return (
    <div
      onMouseDown={(ev) => {
        draggingRef.current = { startX: ev.clientX, startWidth: width };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      style={{
        width: 6,
        cursor: "col-resize",
        background: "transparent",
        borderLeft: "1px solid rgb(var(--color-surface-raised) / 1)",
        borderRight: "1px solid rgb(var(--color-surface-raised) / 1)",
        position: "relative",
      }}
      aria-label="Resize panel"
    >
      {/* Centred grip dots so the user can see where to grab. */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex", flexDirection: "column", gap: 3,
        pointerEvents: "none",
      }}>
        <span style={{ width: 2, height: 2, background: "rgb(var(--color-border-strong) / 1)", borderRadius: 1 }} />
        <span style={{ width: 2, height: 2, background: "rgb(var(--color-border-strong) / 1)", borderRadius: 1 }} />
        <span style={{ width: 2, height: 2, background: "rgb(var(--color-border-strong) / 1)", borderRadius: 1 }} />
      </div>
    </div>
  );
}
