import type { Shape } from "./shape.types.ts";
import { resolveShape } from "./shapes.ts";

/** A single step in a value path: an object key, an array index, or an array wildcard. */
export type PathSeg =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

const IDENT = /[\w$]/;

/**
 * Tokenize a JSONPath-flavored field string into segments.
 *   "payload.user.name" -> [key payload, key user, key name]
 *   "items[0].title"     -> [key items, index 0, key title]
 *   "items[*].title"     -> [key items, wildcard, key title]
 *   "[0].title"          -> [index 0, key title]   (tail-only)
 *   ".user.name"         -> [key user, key name]   (leading separator tolerated, for tails)
 *   ""                   -> []
 * Returns null on malformed input (bad/empty brackets, empty key, double dot).
 */
export function parsePathSegments(field: string): PathSeg[] | null {
  const segs: PathSeg[] = [];
  let i = 0;
  const n = field.length;
  while (i < n) {
    const c = field[i];
    if (c === ".") {
      i++;
      const start = i;
      while (i < n && IDENT.test(field[i])) i++;
      if (i === start) return null; // empty key after '.'
      segs.push({ kind: "key", key: field.slice(start, i) });
    } else if (c === "[") {
      const close = field.indexOf("]", i);
      if (close === -1) return null;
      const inner = field.slice(i + 1, close);
      if (inner === "*") segs.push({ kind: "wildcard" });
      else if (/^\d+$/.test(inner)) segs.push({ kind: "index", index: Number(inner) });
      else return null; // empty or non-numeric index
      i = close + 1;
    } else {
      // A bare identifier is only valid as the very first segment.
      if (segs.length !== 0) return null;
      const start = i;
      while (i < n && IDENT.test(field[i])) i++;
      if (i === start) return null;
      segs.push({ kind: "key", key: field.slice(start, i) });
    }
  }
  return segs;
}

/**
 * Walk `segs` against `root`, resolving named refs along the way.
 *  - key on object -> field shape; key on non-object -> null
 *  - index on array -> item shape (unwrap)
 *  - wildcard on array -> item shape, marking projection (re-wrapped at the end)
 *  - any segment on opaque `json` -> the json shape itself (remaining path allowed)
 * Returns null when a segment doesn't resolve. Empty segs returns root.
 */
export function shapeAtPathSegs(root: Shape, segs: PathSeg[]): Shape | null {
  let cur: Shape = resolveShape(root);
  let projecting = false;
  for (const seg of segs) {
    if (cur.type === "json") return cur; // opaque: stays opaque, rest allowed
    if (seg.kind === "key") {
      if (cur.type !== "object") return null;
      const next = cur.fields[seg.key];
      if (!next) return null;
      cur = resolveShape(next);
    } else if (seg.kind === "index") {
      if (cur.type !== "array") return null;
      cur = resolveShape(cur.items);
    } else {
      if (cur.type !== "array") return null;
      projecting = true;
      cur = resolveShape(cur.items);
    }
  }
  return projecting ? { type: "array", items: cur } : cur;
}
