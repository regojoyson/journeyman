import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedSkillPackage } from "@journeyman/core";
import { existsSync } from "node:fs";

/**
 * Convert resolved skill packages to SDK plugin configs.
 * Each resolved package with a valid localPath becomes one plugin entry.
 */
export function toSdkPluginConfigs(skills: ResolvedSkillPackage[]): SdkPluginConfig[] {
  const seen = new Set<string>();
  const out: SdkPluginConfig[] = [];
  for (const s of skills) {
    if (!s.localPath || !existsSync(s.localPath)) continue;
    if (seen.has(s.localPath)) continue;
    seen.add(s.localPath);
    out.push({ type: "local" as const, path: s.localPath });
  }
  return out;
}

/**
 * Build a system prompt fragment that communicates which individual skills
 * are enabled. Claude Code loads all skills from the plugin directory;
 * this prompt scopes the session to only the enabled subset.
 */
export function buildSkillSystemPrompt(skills: ResolvedSkillPackage[]): string {
  const lines: string[] = [];
  for (const pkg of skills) {
    if (pkg.enabledSkills.length === 0) continue;
    lines.push(`## Skills enabled from "${pkg.name}"`);
    lines.push(`Only use the following skills from this package: ${pkg.enabledSkills.join(", ")}.`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
