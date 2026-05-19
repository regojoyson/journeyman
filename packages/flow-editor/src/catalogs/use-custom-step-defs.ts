import { useEffect, useState } from "react";
import type { CustomAiStep } from "@journeyman/core";
import { useOrgId } from "../state/org-context.tsx";

const cache = new Map<string, Promise<CustomAiStep | null>>();

function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_API_BASE_URL ?? "";
}

async function fetchOne(orgId: string, id: string): Promise<CustomAiStep | null> {
  const base = resolveBaseUrl();
  const tryUrl = async (u: string): Promise<CustomAiStep | null> => {
    const r = await fetch(u, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as CustomAiStep;
  };
  const user = await tryUrl(`${base}/api/orgs/${orgId}/users/me/custom-steps/${id}`);
  if (user) return user;
  return tryUrl(`${base}/api/orgs/${orgId}/custom-steps/${id}`);
}

function getOrFetch(orgId: string, id: string): Promise<CustomAiStep | null> {
  const key = `${orgId}::${id}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchOne(orgId, id).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

export function useCustomStepDefs(ids: string[]): Record<string, CustomAiStep | null> {
  const orgId = useOrgId();
  const [defs, setDefs] = useState<Record<string, CustomAiStep | null>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const next: Record<string, CustomAiStep | null> = {};
    Promise.all(
      ids.map(async (id) => {
        const step = await getOrFetch(orgId, id);
        next[id] = step;
      }),
    ).then(() => {
      if (alive) setDefs((prev) => ({ ...prev, ...next }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key]);
  return defs;
}
