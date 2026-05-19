import { useEffect, useState } from "react";
import type { CustomAiPhase } from "@journeyman/core";
import { useOrgId } from "../state/org-context.tsx";

const cache = new Map<string, Promise<CustomAiPhase | null>>();

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

async function fetchOne(orgId: string, id: string): Promise<CustomAiPhase | null> {
  const base = resolveBaseUrl();
  const tryUrl = async (u: string): Promise<CustomAiPhase | null> => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as CustomAiPhase;
  };
  const user = await tryUrl(`${base}/api/orgs/${orgId}/users/me/custom-phases/${id}`);
  if (user) return user;
  return tryUrl(`${base}/api/orgs/${orgId}/custom-phases/${id}`);
}

function getOrFetch(orgId: string, id: string): Promise<CustomAiPhase | null> {
  const key = `${orgId}::${id}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchOne(orgId, id).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function useCustomPhaseDefs(ids: string[]): Record<string, CustomAiPhase | null> {
  const orgId = useOrgId();
  const [defs, setDefs] = useState<Record<string, CustomAiPhase | null>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const next: Record<string, CustomAiPhase | null> = {};
    Promise.all(
      ids.map(async (id) => {
        const phase = await getOrFetch(orgId, id);
        next[id] = phase;
      }),
    ).then(() => {
      if (alive) setDefs((prev) => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key]);
  return defs;
}
