/**
 * Parse a repos-list input (multi-line textarea and/or comma-separated) into a
 * clean array of trimmed, non-empty URL strings. Splits on newlines and commas;
 * does NOT rewrite URLs (no .git stripping). Arrays are flattened element-wise.
 */
export function parseRepoList(input: string | string[] | undefined): string[] {
  if (input == null) return [];
  const items = Array.isArray(input) ? input : [input];
  return items
    .flatMap((s) => (typeof s === "string" ? s.split(/[\n,]+/) : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
