import { useEffect, useState } from "react";
import type { CustomAiStep } from "@journeyman/core";

export function useVisibleCustomSteps(wsId: string): CustomAiStep[] {
  const [items, setItems] = useState<CustomAiStep[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/workspaces/${wsId}/custom-steps/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (alive) setItems(d as CustomAiStep[]); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [wsId]);
  return items;
}
