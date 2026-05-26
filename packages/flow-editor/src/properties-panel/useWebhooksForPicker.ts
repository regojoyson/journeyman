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
 * Module-level cache + in-flight promise so multiple consumers (e.g. one per
 * webhook-wait canvas node) share a single fetch and re-renders are cheap.
 * Cleared on a full page reload, which is the right granularity for editor use.
 */
let _cache: WebhookForPicker[] | null = null;
let _inFlight: Promise<WebhookForPicker[]> | null = null;
const _subscribers = new Set<(list: WebhookForPicker[]) => void>();

async function fetchWebhooksOnce(): Promise<WebhookForPicker[]> {
  if (_cache) return _cache;
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const [mine, presets] = await Promise.all([
        fetch("/api/users/me/webhooks", { credentials: "include" })
          .then((r) => (r.ok ? (r.json() as Promise<Webhook[]>) : []))
          .catch(() => [] as Webhook[]),
        fetch("/api/webhook-presets", { credentials: "include" })
          .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; knownEventTypes: string[] }>>) : []))
          .catch(() => []),
      ]);
      const presetById = new Map(presets.map((p) => [p.id, p]));
      const list = mine.map((w) => ({
        id: w.id,
        name: w.name,
        preset: w.preset,
        kind: w.kind,
        knownEventTypes: presetById.get(w.preset)?.knownEventTypes ?? [],
        payloadSchema: w.payloadSchema,
      }));
      _cache = list;
      for (const sub of _subscribers) sub(list);
      return list;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

/**
 * Fetch both user-scope and org-scope webhooks visible to the current user.
 * Returns an empty list on any error — the picker degrades to "no options",
 * but the JSON tab still lets authors set webhookId manually.
 *
 * Backed by a module-level cache so N consumers share one network fetch.
 */
export function useWebhooksForPicker(): { webhooks: WebhookForPicker[]; loading: boolean } {
  const [webhooks, setWebhooks] = useState<WebhookForPicker[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);

  useEffect(() => {
    let cancelled = false;
    const onUpdate = (list: WebhookForPicker[]) => {
      if (!cancelled) setWebhooks(list);
    };
    _subscribers.add(onUpdate);
    if (_cache) {
      setWebhooks(_cache);
      setLoading(false);
    } else {
      void fetchWebhooksOnce().then((list) => {
        if (!cancelled) {
          setWebhooks(list);
          setLoading(false);
        }
      });
    }
    return () => {
      cancelled = true;
      _subscribers.delete(onUpdate);
    };
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
