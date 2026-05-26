export type Segment =
  | { kind: "text"; text: string }
  | { kind: "ref"; ref: string };

/**
 * Reference delimiter syntax. `"dollar"` → `${ref}` (used by ConfigTab config
 * templates); `"braces"` → `{{ref}}` (used by custom-ai step template inputs).
 */
export type RefSyntax = "dollar" | "braces";

const REF_RE: Record<RefSyntax, RegExp> = {
  dollar: /\$\{([^}]*)\}/g,
  braces: /\{\{([^}]*)\}\}/g,
};

/** Split a stored template string into ordered text/ref segments. */
export function parseTemplate(s: string, syntax: RefSyntax = "dollar"): Segment[] {
  if (!s) return [];
  const out: Segment[] = [];
  let last = 0;
  const re = new RegExp(REF_RE[syntax].source, "g");
  for (const m of s.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: s.slice(last, idx) });
    out.push({ kind: "ref", ref: m[1] });
    last = idx + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

/** Join segments back into a template string, wrapping refs per the syntax. */
export function segmentsToTemplate(segs: Segment[], syntax: RefSyntax = "dollar"): string {
  const wrap = (ref: string) => (syntax === "braces" ? "{{" + ref + "}}" : "${" + ref + "}");
  return segs
    .map(seg => (seg.kind === "text" ? seg.text : wrap(seg.ref)))
    .join("");
}

/**
 * If the segments represent exactly one ref and no non-whitespace text,
 * return that ref; otherwise null. Used to decide ref-binding vs template.
 */
export function soleRefOf(segs: Segment[]): string | null {
  const refs = segs.filter(s => s.kind === "ref") as Extract<Segment, { kind: "ref" }>[];
  if (refs.length !== 1) return null;
  const hasRealText = segs.some(s => s.kind === "text" && s.text.trim() !== "");
  return hasRealText ? null : refs[0].ref;
}
