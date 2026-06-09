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

/** Every OpenCode built-in tool journeyman knows about. Used to build an
 * EXPLICIT enable/disable map: opencode treats an omitted `tools` param as
 * "all tools on", so a pure-prompt step must disable them by name. */
export const OPENCODE_BUILTIN_TOOL_IDS = [
  "bash", "read", "write", "edit", "grep", "glob", "webfetch",
] as const;

/**
 * Build OpenCode's per-prompt `tools` map with EXPLICIT booleans for every
 * known builtin: selected canonical tools → true, all other builtins → false.
 * An empty canonical list therefore yields an all-false map (no tools), which
 * is what "pure-prompt" must mean — matching the Claude provider's behavior.
 */
export function openCodeToolsConfig(tools: readonly CanonicalTool[]): Record<string, boolean> {
  const enabled = openCodeToolsEnableMap(tools); // { <native>: true } for supported tools
  const out: Record<string, boolean> = {};
  for (const id of OPENCODE_BUILTIN_TOOL_IDS) out[id] = enabled[id] === true;
  // Preserve any enabled tool that isn't in the builtin list (future-proof).
  for (const [id, on] of Object.entries(enabled)) if (!(id in out)) out[id] = on;
  return out;
}
