// packages/flow-editor/src/palette/Palette.tsx
import { useEffect, useMemo, useState } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog } from "../types.ts";
import type { StepDefinition } from "../step-definition.ts";

const COMING_SOON_LS_KEY = "flow-editor.palette.comingSoon";

export interface PaletteProps {
  steps: StepDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | {
      kind: "step";
      stepType: string;
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
    }
  | {
      kind: "trigger";
      triggerType: "trigger-manual" | "trigger-webhook" | "trigger-human";
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    };

const TRIGGER_ENTRIES: AnyEntry[] = [
  {
    kind: "trigger",
    triggerType: "trigger-manual",
    label: "Manual",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "▶",
    description: "Start by clicking Run or via API.",
    comingSoon: false,
  },
  {
    kind: "trigger",
    triggerType: "trigger-webhook",
    label: "Webhook",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "🪝",
    description: "Start when a webhook receives a matching event.",
    comingSoon: false,
  },
  {
    kind: "trigger",
    triggerType: "trigger-human",
    label: "Human form",
    category: "Triggers",
    color: "#6c5ce7",
    icon: "📝",
    description: "Start when a person submits an in-app form.",
    comingSoon: false,
  },
];

function entryKey(e: AnyEntry): string {
  if (e.kind === "step")    return `step:${e.stepType}`;
  if (e.kind === "control") return `control:${e.nodeType}`;
  return `trigger:${e.triggerType}`;
}

function entryDragMime(e: AnyEntry): string {
  if (e.kind === "step")    return "application/journeyman-step";
  if (e.kind === "control") return "application/journeyman-control";
  return "application/journeyman-trigger";
}

export function Palette({ steps, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...TRIGGER_ENTRIES,
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
    ...steps
      .filter((p) => !p.hiddenFromPalette)
      .map((p): AnyEntry => ({
        kind: "step",
        stepType: p.stepType,
        label: p.label,
        category: p.category,
        color: p.color,
        icon: p.icon,
        description: p.description,
        comingSoon: p.comingSoon === true,
      })),
  ], [steps, controlCatalog]);

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
        Steps
      </div>

      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={entryKey(it)}
              entry={{
                ...it,
                dragMime: entryDragMime(it),
                ...(it.kind === "step"    ? { stepType: it.stepType }    : {}),
                ...(it.kind === "control" ? { nodeType: it.nodeType }    : {}),
                ...(it.kind === "trigger" ? { triggerType: it.triggerType } : {}),
              }}
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
                      entry={{
                        ...it,
                        dragMime: entryDragMime(it),
                        ...(it.kind === "step"    ? { stepType: it.stepType }    : {}),
                        ...(it.kind === "control" ? { nodeType: it.nodeType }    : {}),
                        ...(it.kind === "trigger" ? { triggerType: it.triggerType } : {}),
                      }}
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
