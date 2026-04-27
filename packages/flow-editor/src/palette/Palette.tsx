import { useMemo } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog, PhaseCatalog } from "../types.ts";

export interface PaletteProps {
  catalog: PhaseCatalog;
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | { kind: "phase";   phaseType: string; label: string; category: string; color: string; icon: string; description?: string }
  | { kind: "control"; nodeType: string;  label: string; category: string; color: string; icon: string; description?: string };

export function Palette({ catalog, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...catalog.map(c => ({ kind: "phase" as const, ...c })),
    ...(controlCatalog ?? []).map(c => ({ kind: "control" as const, ...c })),
  ], [catalog, controlCatalog]);

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of entries) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [entries]);

  return (
    <aside className="je-editor__palette">
      <div className="je-palette__title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phases</div>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={it.kind === "phase" ? `phase:${it.phaseType}` : `control:${it.nodeType}`}
              entry={{ ...it, dragMime: it.kind === "phase" ? "application/journeyman-phase" : "application/journeyman-control" }}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}
