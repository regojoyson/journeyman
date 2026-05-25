import { readPath } from "./path.ts";

export type EventTypeSource = {
  /** Lowercased header map. */
  headers: Record<string, string>;
  payload: unknown;
};

/**
 * Resolve a webhook's `eventTypePath`:
 *   - "header:x-github-event" → headers["x-github-event"]
 *   - "$.webhookEvent"        → payload.webhookEvent
 *   - "$.type + '.' + $.action" → not supported in v1; return null.
 */
export function extractEventType(spec: string | undefined, src: EventTypeSource): string | null {
  if (!spec) return null;
  if (spec.startsWith("header:")) {
    const h = spec.slice("header:".length).toLowerCase();
    return src.headers[h] ?? null;
  }
  if (spec.startsWith("$") || spec.includes(".")) {
    const v = readPath(src.payload, spec);
    return typeof v === "string" ? v : v == null ? null : String(v);
  }
  return null;
}
