import { useEffect, useState } from "react";
import type { CustomAiPhase } from "@journeyman/core";

export function useVisibleCustomPhases(orgId: string): CustomAiPhase[] {
  const [items, setItems] = useState<CustomAiPhase[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/custom-phases/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (alive) setItems(d as CustomAiPhase[]); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [orgId]);
  return items;
}
