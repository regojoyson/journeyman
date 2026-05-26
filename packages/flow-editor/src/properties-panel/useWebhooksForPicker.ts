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

/**
 * Fetch both user-scope and org-scope webhooks visible to the current user.
 * Returns an empty list on any error — the picker degrades to "no options",
 * but the JSON tab still lets authors set webhookId manually.
 */
export function useWebhooksForPicker(): { webhooks: WebhookForPicker[]; loading: boolean } {
  const [webhooks, setWebhooks] = useState<WebhookForPicker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [mine, presets] = await Promise.all([
          fetch("/api/users/me/webhooks", { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<Webhook[]>) : []))
            .catch(() => [] as Webhook[]),
          fetch("/api/webhook-presets", { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; knownEventTypes: string[] }>>) : []))
            .catch(() => []),
        ]);
        if (cancelled) return;
        const presetById = new Map(presets.map((p) => [p.id, p]));
        setWebhooks(mine.map((w) => ({
          id: w.id,
          name: w.name,
          preset: w.preset,
          kind: w.kind,
          knownEventTypes: presetById.get(w.preset)?.knownEventTypes ?? [],
          payloadSchema: w.payloadSchema,
        })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return { webhooks, loading };
}

/**
 * Walks a JSON Schema and produces dot-paths for use as fromPath autocomplete
 * suggestions, e.g. ["$.action", "$.issue.number", "$.repository.full_name"].
 * Stops at `maxDepth` to keep the suggestion list manageable.
 */
export function pathsFromSchema(schema: unknown, maxDepth = 4): string[] {
  if (!schema || typeof schema !== "object") return [];
  const out: string[] = [];
  walk(schema as Record<string, unknown>, "$", out, maxDepth);
  return out;
}

function walk(node: Record<string, unknown>, prefix: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  const props = node["properties"];
  if (props && typeof props === "object") {
    for (const [k, child] of Object.entries(props as Record<string, unknown>)) {
      const path = `${prefix}.${k}`;
      out.push(path);
      if (child && typeof child === "object") {
        walk(child as Record<string, unknown>, path, out, depth - 1);
      }
    }
  }
}
