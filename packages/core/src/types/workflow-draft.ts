import type { WorkflowGraph } from "./flow.types.ts";

/** Deterministic JSON serialization with sorted object keys (arrays keep order). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Structural equality of two workflow graphs, insensitive to object-key order. */
export function graphsEqual(a: WorkflowGraph, b: WorkflowGraph): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * True when the draft differs from what is published.
 * No published version ⇒ always true (the draft is unpublished work).
 */
export function hasUnpublishedChanges(draft: WorkflowGraph, published: WorkflowGraph | null): boolean {
  if (!published) return true;
  return !graphsEqual(draft, published);
}
