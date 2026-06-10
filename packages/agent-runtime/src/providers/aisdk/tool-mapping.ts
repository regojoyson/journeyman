import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

/** Canonical → native aisdk tool ids. `null` = unsupported (flagged by unsupportedTools). */
export const AISDK_TOOL_MAP: ProviderToolMap = {
  "bash":       ["bash"],
  "read-file":  ["read"],
  "write-file": ["write"],
  "edit-file":  ["edit"],
  "search":     ["search"],
  "web-fetch":  ["web_fetch"],
  "web-search": null,
};

/** Native tool ids to include for the given canonical tools (deduped, order-stable). */
export function aiSdkToolIds(tools: readonly CanonicalTool[]): string[] {
  const out: string[] = [];
  for (const t of tools) {
    const native = AISDK_TOOL_MAP[t];
    if (!native) continue;
    for (const id of native) if (!out.includes(id)) out.push(id);
  }
  return out;
}
