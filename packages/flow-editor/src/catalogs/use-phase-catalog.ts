import { useEffect, useState } from "react";
import type { OutputSchema } from "@journeyman/core";

export interface PhaseInputFieldMeta { type: string; label?: string }
export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  inputFields: Record<string, PhaseInputFieldMeta>;
  outputSchema: OutputSchema | null;
}

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

/** Map keyed by phaseType, with both input fields and output schema for each phase. */
export function usePhaseCatalog(): Record<string, PhaseCatalogEntry> {
  const [m, setM] = useState<Record<string, PhaseCatalogEntry>>({});
  useEffect(() => {
    const url = `${resolveBaseUrl()}/api/phases`;
    fetch(url, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`/phases returned ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        const d = raw as { phases: PhaseCatalogEntry[] };
        if (!d?.phases) return;
        setM(Object.fromEntries(d.phases.map(p => [p.phaseType, p])));
      })
      .catch(err => {
        console.warn("[usePhaseCatalog] failed to load /phases:", err);
      });
  }, []);
  return m;
}
