/** Max characters for a single input value before it is clamped. */
const VALUE_MAX = 40;

export interface RefLabel {
  /** Input keys joined with " · ": "branch" or "repo · branch" */
  keyLabel: string;
  /** Formatted values joined with " · ": "main" or "acme/api · main" */
  valueText: string;
  /** Full tooltip text: "repo: acme/api · branch: main". Each value passes through
   *  formatValue() (40-char cap) but the total string has no additional length cap. */
  full: string;
}

/**
 * Format a single input value as a clean one-line string.
 * Primitives render bare (no quotes); objects/arrays render as compact JSON.
 * Clamped to VALUE_MAX chars. Unserializable values fall back to "…".
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
 * Format workflow/agent run inputs as a structured label for the list table.
 * Returns null when inputs are absent, empty, or entirely null/undefined —
 * callers render their own fallback (dash or nothing).
 */
export function refLabel(inputs: Record<string, unknown> | undefined): RefLabel | null {
  if (!inputs) return null;
  const keys: string[] = [];
  const vals: string[] = [];
  const fullPairs: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null) continue;
    const fv = formatValue(v);
    keys.push(k);
    vals.push(fv);
    fullPairs.push(`${k}: ${fv}`);
  }
  if (keys.length === 0) return null;
  return {
    keyLabel: keys.join(" · "),
    valueText: vals.join(" · "),
    full: fullPairs.join(" · "),
  };
}
