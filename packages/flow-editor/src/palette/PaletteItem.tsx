import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolvePhaseIcon } from "../icons/resolve.tsx";

export interface PaletteItemEntryLike {
  label: string;
  description?: string;
  color: string;
  icon: string;
  phaseType?: string;
  nodeType?: string;
  dragMime: string;
}

export interface PaletteItemProps {
  entry: PaletteItemEntryLike;
  /** When true, the item is rendered muted, is not draggable, and shows
   *  a "Coming soon" tooltip via the title attribute. */
  disabled?: boolean;
}

export function PaletteItem({ entry, disabled = false }: PaletteItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  const onDragStart = (ev: React.DragEvent) => {
    if (disabled) {
      ev.preventDefault();
      return;
    }
    const value = entry.phaseType ?? entry.nodeType ?? "";
    ev.dataTransfer.setData(entry.dragMime, value);
    ev.dataTransfer.effectAllowed = "move";
    setPopPos(null);
  };

  const onMouseEnter = () => {
    if (!entry.description) return;
    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopPos({ top: rect.top, left: rect.right + 8 });
  };

  const onMouseLeave = () => setPopPos(null);

  const className = disabled
    ? "je-palette__item je-palette__item--disabled"
    : "je-palette__item";

  return (
    <div
      ref={itemRef}
      className={className}
      draggable={!disabled}
      onDragStart={onDragStart}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={disabled ? "Coming soon — not yet available" : undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="je-palette__icon" style={{ background: entry.color }}>
        {resolvePhaseIcon(entry.icon, { size: 16, className: "je-palette__icon-svg" })}
      </div>
      <span className="je-palette__label">{entry.label}</span>
      {entry.description && (
        <span className="je-palette__info" aria-label="info">i</span>
      )}
      {popPos && entry.description && createPortal(
        <div
          className="je-palette__popover"
          style={{ position: "fixed", top: popPos.top, left: popPos.left }}
        >
          <div className="je-palette__popover-title">{entry.label}</div>
          <div className="je-palette__popover-desc">{entry.description}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
