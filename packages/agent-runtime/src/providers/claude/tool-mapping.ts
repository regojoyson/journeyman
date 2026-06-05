import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

export const CLAUDE_TOOL_MAP: ProviderToolMap = {
  "bash":       ["Bash"],
  "read-file":  ["Read"],
  "write-file": ["Write"],
  "edit-file":  ["Edit"],
  "search":     ["Grep", "Glob"],
  "web-fetch":  ["WebFetch"],
  "web-search": ["WebSearch"],
};

export function claudeNativeTools(tools: readonly CanonicalTool[]): string[] {
  const out: string[] = [];
  for (const t of tools) {
    const native = CLAUDE_TOOL_MAP[t];
    if (native) out.push(...native);
  }
  return Array.from(new Set(out));
}
