import { parsePathSegments } from "@journeyman/core";
import type { MentionField } from "./mention-fields.ts";

/**
 * Split a (possibly drilled) ref into the picked base ref + the appended path
 * tail. The base is the longest known field ref that prefixes `ref` at a
 * segment boundary (next char is "." or "["). Falls back to the whole ref.
 */
export function splitRefPath(ref: string, fields: MentionField[]): { baseRef: string; tail: string } {
  let best = "";
  for (const f of fields) {
    if (ref === f.ref) return { baseRef: f.ref, tail: "" };
    if (ref.startsWith(f.ref)) {
      const next = ref[f.ref.length];
      if ((next === "." || next === "[") && f.ref.length > best.length) best = f.ref;
    }
  }
  if (!best) return { baseRef: ref, tail: "" };
  return { baseRef: best, tail: ref.slice(best.length) };
}

/** Concatenate a base ref and a path tail (tail already includes its leading "."/"["). */
export function joinRefPath(baseRef: string, tail: string): string {
  return baseRef + tail;
}

/**
 * Validate a path tail typed by the user. Empty is allowed. Non-empty must begin
 * with "." or "[" and tokenize cleanly into key/index/wildcard segments.
 */
export function validatePathTail(tail: string): { ok: boolean; error?: string } {
  if (tail === "") return { ok: true };
  if (tail[0] !== "." && tail[0] !== "[") {
    return { ok: false, error: "Path must start with '.' or '['" };
  }
  const segs = parsePathSegments(tail);
  if (!segs) return { ok: false, error: "Invalid path — use .field, [0], or [*]" };
  return { ok: true };
}
