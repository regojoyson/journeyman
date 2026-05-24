import { useMemo } from "react";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

export interface InputNameGroup {
  group: string;
  names: string[];
}

export function useStepInputNames(
  catalog: Record<string, StepCatalogEntry>,
  scope: "catalog" | "canvas",
  canvasStepTypes: string[],
): InputNameGroup[] {
  return useMemo(() => {
    const entries = Object.values(catalog);
    const scoped = scope === "canvas"
      ? entries.filter(e => canvasStepTypes.includes(e.stepType))
      : entries;

    const byGroup = new Map<string, Set<string>>();
    for (const entry of scoped) {
      const names = Object.keys(entry.inputFields);
      if (!names.length) continue;
      if (!byGroup.has(entry.category)) byGroup.set(entry.category, new Set());
      for (const n of names) byGroup.get(entry.category)!.add(n);
    }

    return [...byGroup.entries()]
      .map(([group, nameSet]) => ({ group, names: [...nameSet].sort() }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [catalog, scope, canvasStepTypes]);
}
