/**
 * Minimal dot-path JSON traversal used for extracting outcome values and
 * comment text from webhook payloads. Supports `a.b.c`, `a.b[0].c`, and the
 * JSONPath root token: `$.a.b.c` (root stripped) and `$` (whole object). The
 * `$`-prefixed form is what the flow editor stores for correlation keys and
 * output `fromPath`, so it must resolve here too.
 * Returns null if any segment is missing.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return null;
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  if (p === "$") return obj;
  const segments = p
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

export function getStringByPath(obj: unknown, path: string): string | null {
  const v = getByPath(obj, path);
  return typeof v === "string" ? v : v == null ? null : String(v);
}
