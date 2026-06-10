import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";
import { CLAUDE_TOOL_MAP } from "./claude/tool-mapping.ts";
import { GEMINI_TOOL_MAP } from "./gemini/tool-mapping.ts";
import { CODEX_TOOL_MAP } from "./codex/tool-mapping.ts";
import { OPENCODE_TOOL_MAP } from "./opencode/tool-mapping.ts";
import { AISDK_TOOL_MAP } from "./aisdk/tool-mapping.ts";

export type ProviderId = "claude" | "gemini" | "codex" | "opencode" | "aisdk";

export const PROVIDER_TOOL_MAPS: Record<ProviderId, ProviderToolMap> = {
  claude:   CLAUDE_TOOL_MAP,
  gemini:   GEMINI_TOOL_MAP,
  codex:    CODEX_TOOL_MAP,
  opencode: OPENCODE_TOOL_MAP,
  aisdk:    AISDK_TOOL_MAP,
};

export function unsupportedTools(
  provider: ProviderId,
  tools: readonly CanonicalTool[],
): CanonicalTool[] {
  const map = PROVIDER_TOOL_MAPS[provider];
  if (!map) return [];
  return tools.filter((t) => map[t] === null);
}
