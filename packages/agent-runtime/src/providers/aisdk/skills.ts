import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tool, jsonSchema } from "ai";
import type { ResolvedSkillPackage } from "@journeyman/core";

/** Candidate SKILL.md paths for a named skill within a package dir. */
function skillPaths(localPath: string, name: string): string[] {
  return [join(localPath, name, "SKILL.md"), join(localPath, "SKILL.md")];
}

function descriptionOf(localPath: string, name: string): string {
  for (const p of skillPaths(localPath, name)) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const m = text.match(/^description:\s*(.+)$/m);
    return m ? m[1].trim() : "";
  }
  return "";
}

/** A system-prompt fragment listing the enabled skills (name + description). */
export function buildSkillMenu(skills: ResolvedSkillPackage[]): string {
  const lines: string[] = [];
  for (const pkg of skills) {
    for (const name of pkg.enabledSkills) {
      const desc = descriptionOf(pkg.localPath, name);
      lines.push(`- ${name}${desc ? `: ${desc}` : ""}`);
    }
  }
  if (lines.length === 0) return "";
  return [
    "## Available skills",
    "Call the `Skill` tool with a skill name to load its full instructions, then follow them.",
    ...lines,
  ].join("\n");
}

/** Read the full body for a named enabled skill, or a not-found message. */
export async function readSkillBody(skills: ResolvedSkillPackage[], name: string): Promise<string> {
  for (const pkg of skills) {
    if (!pkg.enabledSkills.includes(name)) continue;
    for (const p of skillPaths(pkg.localPath, name)) {
      if (existsSync(p)) return readFile(p, "utf8");
    }
  }
  return `Skill "${name}" not found.`;
}

export function skillTool(skills: ResolvedSkillPackage[]) {
  return tool({
    description: "Load the full instructions for a named skill from the available-skills list.",
    inputSchema: jsonSchema<{ name: string }>({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
    execute: ({ name }: { name: string }) => readSkillBody(skills, name),
  });
}
