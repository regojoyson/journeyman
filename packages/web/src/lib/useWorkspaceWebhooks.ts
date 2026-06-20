import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";

export interface WebhookForPicker {
  id: string;
  name: string;
  preset: string;
  kind: "ticket" | "git";
  knownEventTypes: string[];
  payloadSchema?: unknown;
}

async function fetchWorkspaceWebhooks(wsId: string): Promise<WebhookForPicker[]> {
  const [webhooks, presets] = await Promise.all([
    fetch(`/api/workspaces/${encodeURIComponent(wsId)}/webhooks`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<Webhook[]>) : []))
      .catch(() => [] as Webhook[]),
    fetch("/api/webhook-presets", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; knownEventTypes: string[] }>>) : []))
      .catch(() => []),
  ]);
  const presetById = new Map(presets.map((p) => [p.id, p]));
  return webhooks.map((w) => ({
    id: w.id,
    name: w.name,
    preset: w.preset,
    kind: w.kind,
    knownEventTypes: presetById.get(w.preset)?.knownEventTypes ?? [],
    payloadSchema: w.payloadSchema,
  }));
}

export function useWorkspaceWebhooks(wsId: string): { webhooks: WebhookForPicker[]; loading: boolean; refresh: () => void } {
  const [webhooks, setWebhooks] = useState<WebhookForPicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkspaceWebhooks(wsId).then((list) => {
      if (!cancelled) {
        setWebhooks(list);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [wsId, seq]);

  return { webhooks, loading, refresh: () => setSeq((s) => s + 1) };
}
