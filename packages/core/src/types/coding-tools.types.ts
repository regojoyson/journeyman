// Canonical, provider-agnostic tool vocabulary used by custom AI steps.
// Each coding-cli provider owns a mapping from these names to its native tool
// names. See packages/coding-cli/src/providers/*/tool-mapping.ts.

export const CANONICAL_TOOLS = [
  "bash",
  "read-file",
  "write-file",
  "edit-file",
  "search",
  "web-fetch",
  "web-search",
] as const;

export type CanonicalTool = (typeof CANONICAL_TOOLS)[number];

export const WORKSPACE_TOOLS: readonly CanonicalTool[] = [
  "bash",
  "read-file",
  "write-file",
  "edit-file",
  "search",
] as const;

export function isCanonicalTool(value: unknown): value is CanonicalTool {
  return typeof value === "string" && (CANONICAL_TOOLS as readonly string[]).includes(value);
}

export function toolsRequireWorkspace(tools: readonly CanonicalTool[]): boolean {
  return tools.some((t) => (WORKSPACE_TOOLS as readonly string[]).includes(t));
}

export function dedupeTools(tools: readonly CanonicalTool[]): CanonicalTool[] {
  return Array.from(new Set(tools));
}

// A provider's mapping table. `null` marks an unsupported tool on that
// provider; the editor uses this to flag node configs as broken.
export type ProviderToolMap = Record<CanonicalTool, string[] | null>;
