import { useRef, useState } from "react";
import { createPortal } from "react-dom";

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
}

export function PaletteItem({ entry }: PaletteItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  const onDragStart = (ev: React.DragEvent) => {
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

  return (
    <div
      ref={itemRef}
      className="je-palette__item"
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
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
