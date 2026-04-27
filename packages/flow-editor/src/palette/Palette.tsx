import { useMemo } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { PhaseCatalog } from "../types.ts";

export interface PaletteProps { catalog: PhaseCatalog; }

export function Palette({ catalog }: PaletteProps) {
  const grouped = useMemo(() => {
    const m = new Map<string, PhaseCatalog>();
    for (const e of catalog) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [catalog]);
  return (
    <aside className="je-editor__palette">
      <div className="je-palette__title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phases</div>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => <PaletteItem key={it.phaseType} entry={it} />)}
        </div>
      ))}
    </aside>
  );
}
