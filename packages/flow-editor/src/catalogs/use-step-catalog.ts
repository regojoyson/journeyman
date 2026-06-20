import { useEffect, useState } from "react";
import type { OutputSchema, InputField, ConnectionCategory } from "@journeyman/core";

export type StepInputFieldMeta = InputField;
export interface StepCatalogEntry {
  stepType: string;
  label: string;
  category: string;
  inputFields: Record<string, StepInputFieldMeta>;
  outputSchema: OutputSchema | null;
  connectionCategory?: ConnectionCategory;
}

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

/** Map keyed by stepType, with both input fields and output schema for each step. */
export function useStepCatalog(): Record<string, StepCatalogEntry> {
  const [m, setM] = useState<Record<string, StepCatalogEntry>>({});
  useEffect(() => {
    const url = `${resolveBaseUrl()}/api/steps`;
    fetch(url, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`/steps returned ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        const d = raw as { steps: StepCatalogEntry[] };
        if (!d?.steps) return;
        setM(Object.fromEntries(d.steps.map(p => [p.stepType, p])));
      })
      .catch(err => {
        console.warn("[useStepCatalog] failed to load /steps:", err);
      });
  }, []);
  return m;
}
