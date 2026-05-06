// packages/flow-editor/src/palette/Palette.tsx
import { useEffect, useMemo, useState } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog } from "../types.ts";
import type { PhaseDefinition } from "../phase-definition.ts";

const COMING_SOON_LS_KEY = "flow-editor.palette.comingSoon";

export interface PaletteProps {
  phases: PhaseDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | {
      kind: "phase";
      phaseType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    }
  | {
      kind: "control";
      nodeType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    };

function entryKey(e: AnyEntry): string {
  return e.kind === "phase" ? `phase:${e.phaseType}` : `control:${e.nodeType}`;
}

function entryDragMime(e: AnyEntry): string {
  return e.kind === "phase"
    ? "application/journeyman-phase"
    : "application/journeyman-control";
}

export function Palette({ phases, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...phases.map((p): AnyEntry => ({
      kind: "phase",
      phaseType: p.phaseType,
      label: p.label,
      category: p.category,
      color: p.color,
      icon: p.icon,
      description: p.description,
      comingSoon: p.comingSoon === true,
    })),
    ...(controlCatalog ?? []).map((c): AnyEntry => ({
      kind: "control",
      nodeType: c.nodeType,
      label: c.label,
      category: c.category,
      color: c.color,
      icon: c.icon,
      description: c.description,
      comingSoon: c.comingSoon === true,
    })),
  ], [phases, controlCatalog]);

  const available = useMemo(
    () => entries.filter(e => !e.comingSoon),
    [entries],
  );
  const comingSoon = useMemo(
    () => entries.filter(e => e.comingSoon),
    [entries],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of available) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [available]);

  const groupedComingSoon = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of comingSoon) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [comingSoon]);

  const [csOpen, setCsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMING_SOON_LS_KEY) === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMING_SOON_LS_KEY, String(csOpen));
  }, [csOpen]);

  return (
    <aside className="je-editor__palette">
      <div
        className="je-palette__title"
        style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
      >
        Phases
      </div>

      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={entryKey(it)}
              entry={{ ...it, dragMime: entryDragMime(it) }}
            />
          ))}
        </div>
      ))}

      {comingSoon.length > 0 && (
        <div className="je-palette__coming-soon">
          <button
            type="button"
            className="je-palette__coming-soon-header"
            aria-expanded={csOpen}
            onClick={() => setCsOpen(o => !o)}
          >
            <span className="je-palette__coming-soon-caret">{csOpen ? "▾" : "▸"}</span>
            <span className="je-palette__coming-soon-label">Coming soon</span>
            <span className="je-palette__coming-soon-count">({comingSoon.length})</span>
          </button>
          {csOpen && (
            <div className="je-palette__coming-soon-body">
              {groupedComingSoon.map(([cat, items]) => (
                <div key={cat}>
                  <div className="je-palette__group">{cat}</div>
                  {items.map(it => (
                    <PaletteItem
                      key={entryKey(it)}
                      entry={{ ...it, dragMime: entryDragMime(it) }}
                      disabled
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
