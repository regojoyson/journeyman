import type { PhaseCatalogEntry } from "../types.ts";

export interface PaletteItemProps {
  entry: PhaseCatalogEntry;
}

export function PaletteItem({ entry }: PaletteItemProps) {
  const onDragStart = (ev: React.DragEvent) => {
    ev.dataTransfer.setData("application/journeyman-phase", entry.phaseType);
    ev.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="je-palette__item" draggable onDragStart={onDragStart} title={entry.description ?? ""}>
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
      <span>{entry.label}</span>
    </div>
  );
}
