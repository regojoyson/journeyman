import { useEffect, useState } from "react";
import type { CustomAiStep } from "@journeyman/core";
import { useWsId } from "../state/org-context.tsx";

const cache = new Map<string, Promise<CustomAiStep | null>>();

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

async function fetchOne(wsId: string, id: string): Promise<CustomAiStep | null> {
  const base = resolveBaseUrl();
  const r = await fetch(`${base}/api/workspaces/${wsId}/custom-steps/${id}`, { credentials: "include" });
  if (!r.ok) return null;
  return (await r.json()) as CustomAiStep;
}

function getOrFetch(wsId: string, id: string): Promise<CustomAiStep | null> {
  const key = `${wsId}::${id}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchOne(wsId, id).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function useCustomStepDefs(ids: string[]): Record<string, CustomAiStep | null> {
  const wsId = useWsId();
  const [defs, setDefs] = useState<Record<string, CustomAiStep | null>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    const next: Record<string, CustomAiStep | null> = {};
    Promise.all(
      ids.map(async (id) => {
        const step = await getOrFetch(wsId, id);
        next[id] = step;
      }),
    ).then(() => {
      if (alive) setDefs((prev) => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, key]);
  return defs;
}
