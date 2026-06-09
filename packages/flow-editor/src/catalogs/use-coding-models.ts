import { useEffect, useState } from "react";
import type { CodingModel } from "@journeyman/core";

/** Fetch enabled coding models for a provider (with their config). Empty until loaded. */
export function useCodingModels(provider: string | undefined): CodingModel[] {
  const [models, setModels] = useState<CodingModel[]>([]);
  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let alive = true;
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CodingModel[]) => { if (alive) setModels(rows); })
      .catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider]);
  return models;
}
