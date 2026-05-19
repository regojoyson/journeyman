/**
 * Strip markdown autolink syntax `[text](url)` introduced when domain-shaped
 * tokens (e.g. `node.output.id`) get auto-linkified in rich-text contexts.
 * Repeats until stable so nested/multiple wrappings collapse.
 */
export function sanitizeRef(ref: string): string {
  let out = ref;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    if (next === out) return next;
    out = next;
  }
}
