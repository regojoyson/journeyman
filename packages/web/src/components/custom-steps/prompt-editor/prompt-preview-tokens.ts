export type TokenSegment =
  | { kind: "text"; value: string }
  | { kind: "input"; name: string }
  | { kind: "slot"; name: string };

/** {{name}} OR $NAME (with a negative lookbehind so a preceding identifier char excludes it). */
const COMBINED = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|(?<![A-Z0-9_])\$([A-Z][A-Z0-9_]*)/g;

/** Split a plain string into ordered text/input/slot segments. */
export function splitTokens(text: string): TokenSegment[] {
  const out: TokenSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(COMBINED)) {
    const idx = m.index!;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    if (m[1] !== undefined) out.push({ kind: "input", name: m[1] });
    else out.push({ kind: "slot", name: m[2] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
