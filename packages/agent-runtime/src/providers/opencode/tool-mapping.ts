import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

/**
 * Canonical → native OpenCode tool ids. `null` marks a canonical tool with no
 * OpenCode equivalent (the flow-editor flags null-mapped tools as unsupported).
 * web-search has no native OpenCode tool.
 */
export const OPENCODE_TOOL_MAP: ProviderToolMap = {
  "bash":       ["bash"],
  "read-file":  ["read"],
  "write-file": ["write"],
  "edit-file":  ["edit"],
  "search":     ["grep", "glob"],
  "web-fetch":  ["webfetch"],
  "web-search": null,
};

/**
 * Build OpenCode's per-prompt `tools` enable map ({ toolId: true }) from canonical
 * tool names. Unsupported (null) and unknown tools are skipped.
 */
export function openCodeToolsEnableMap(tools: readonly CanonicalTool[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of tools) {
    const native = OPENCODE_TOOL_MAP[t];
    if (!native) continue;
    for (const id of native) out[id] = true;
  }
  return out;
}
