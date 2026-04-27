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
  const onDragStart = (ev: React.DragEvent) => {
    const value = entry.phaseType ?? entry.nodeType ?? "";
    ev.dataTransfer.setData(entry.dragMime, value);
    ev.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="je-palette__item" draggable onDragStart={onDragStart} title={entry.description ?? ""}>
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
      <span>{entry.label}</span>
    </div>
  );
}
