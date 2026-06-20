/**
 * Walks a JSON Schema and produces dot-paths for payload-path autocomplete,
 * e.g. ["$.action", "$.issue.number", "$.repository.full_name"].
 * Stops at `maxDepth` to keep the suggestion list manageable.
 */
export function pathsFromSchema(schema: unknown, maxDepth = 4): string[] {
  if (!schema || typeof schema !== "object") return [];
  const out: string[] = [];
  walk(schema as Record<string, unknown>, "$", out, maxDepth);
  return out;
}

function walk(node: Record<string, unknown>, prefix: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  const props = node["properties"];
  if (props && typeof props === "object") {
    for (const [k, child] of Object.entries(props as Record<string, unknown>)) {
      const path = `${prefix}.${k}`;
      out.push(path);
      if (child && typeof child === "object") {
        walk(child as Record<string, unknown>, path, out, depth - 1);
      }
    }
  }
}
