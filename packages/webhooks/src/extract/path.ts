/**
 * Read a value from `obj` using a JSON dot-path. Returns `undefined` when any
 * segment is missing. Examples: "$.foo.bar", "foo.bar", "items[0].name".
 */
export function readPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  if (p === "$") return obj;

  const segments: Array<string | number> = [];
  for (const part of p.split(".")) {
    if (!part) continue;
    // "items[0]" → "items", 0
    const m = part.match(/^([^[]+)((?:\[\d+\])*)$/);
    if (m) {
      segments.push(m[1]!);
      const idxs = m[2]!.match(/\[(\d+)\]/g) ?? [];
      for (const i of idxs) segments.push(Number(i.slice(1, -1)));
    } else {
      segments.push(part);
    }
  }

  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}
