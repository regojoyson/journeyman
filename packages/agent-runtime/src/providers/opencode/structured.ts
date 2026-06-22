type Schema = Record<string, unknown>;
type Props = Record<string, { type?: string }>;

function jsType(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v; // "string" | "number" | "boolean" | "object" | ...
}

function typeMatches(declared: string | undefined, value: unknown): boolean {
  if (!declared) return true;
  if (declared === "object") return jsType(value) === "object";
  if (declared === "array") return Array.isArray(value);
  return jsType(value) === declared; // string/number/boolean
}

/** Lightweight check of a value against an outputFieldsToJsonSchema()-shaped schema. */
export function validateStructured(
  value: unknown,
  schema: Schema,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (jsType(value) !== "object") return { ok: false, reason: "result is not an object" };
  const obj = value as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Props;
  const required = (schema.required ?? []) as string[];
  for (const name of required) {
    if (!(name in obj)) return { ok: false, reason: `missing required field "${name}"` };
  }
  for (const [name, def] of Object.entries(props)) {
    if (name in obj && !typeMatches(def?.type, obj[name])) {
      return { ok: false, reason: `field "${name}" should be ${def?.type}` };
    }
  }
  return { ok: true, value: obj };
}

/** Best-effort recovery of a schema-conforming object from free text. Never loosens
 * validation: a salvaged value is returned only if it passes validateStructured(). */
export function salvageStructured(text: string, schema: Schema): Record<string, unknown> | undefined {
  if (!text) return undefined;
  // 1. Embedded JSON object.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const v = validateStructured(parsed, schema);
      if (v.ok) return v.value;
    } catch { /* not JSON */ }
  }
  // 2. Single-field scalar schemas: pull the scalar out of prose.
  const props = (schema.properties ?? {}) as Props;
  const names = Object.keys(props);
  if (names.length === 1) {
    const name = names[0];
    const t = props[name]?.type;
    if (t === "boolean") {
      const m = text.match(/\b(true|false)\b/i);
      if (m) return { [name]: m[1].toLowerCase() === "true" };
    } else if (t === "number") {
      const m = text.match(/-?\d+(\.\d+)?/);
      if (m) return { [name]: Number(m[0]) };
    } else if (t === "string") {
      // Only salvage a BARE value — a single, short line that plausibly IS the
      // value (e.g. a path). Dumping multi-line/prose text here passes validation
      // (any string satisfies a string field) and sends a whole summary downstream
      // as if it were the answer. Reject prose; let the caller fail clearly instead.
      const v = text.trim();
      if (v && !v.includes("\n") && v.length <= 512) return { [name]: v };
    }
  }
  return undefined;
}
