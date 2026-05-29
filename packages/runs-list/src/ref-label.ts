/** Max characters for a single input value before it is clamped (so one large
 *  value cannot crowd the others out of the Ref column). */
const VALUE_MAX = 40;
/** Max characters for the whole visible Ref string. Full text goes in the tooltip. */
const LABEL_MAX = 60;

/**
 * Format a single input value as a clean one-line string for the Ref column.
 * Primitives render bare (no quotes); objects/arrays render as compact JSON.
 * The result is clamped to VALUE_MAX chars. Unserializable values fall back to "…".
 */
export function formatValue(v: unknown): string {
  let s: string;
  if (typeof v === "string") {
    s = v;
  } else if (typeof v === "number" || typeof v === "boolean") {
    s = String(v);
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      return "…";
    }
    if (s === undefined) return "…";
  }
  return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX - 1) + "…" : s;
}

/**
 * Render the workflow inputs as a short "key=value, key=value" summary for the
 * leftmost column. All non-null values are rendered (objects/arrays as compact
 * JSON). Each value is clamped individually; the full joined string goes in the
 * tooltip and the visible string is clamped to LABEL_MAX.
 */
export function refLabel(inputs: Record<string, unknown> | undefined): { text: string; title?: string } {
  if (!inputs) return { text: "—" };
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null) continue;
    pairs.push(`${k}=${formatValue(v)}`);
  }
  if (pairs.length === 0) return { text: "—" };
  const full = pairs.join(", ");
  const text = full.length > LABEL_MAX ? full.slice(0, LABEL_MAX - 3) + "…" : full;
  return { text, title: full };
}
