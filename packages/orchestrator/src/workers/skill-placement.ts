import { bundleEnabledSkills } from "@journeyman/skills";
import type { FileBundle, ResolvedSkillPackage } from "@journeyman/core";

const CLAUDE_SKILLS_DIR = "/workspace/.journeyman/skills";

/**
 * Deliver skills into the container in the layout the provider expects, and
 * return skills with localPath rewritten to the in-container location.
 * Container-path only; for local, callers skip this (skills load from the pantry).
 */
export async function placeSkills(
  provider: string | undefined,
  skills: ResolvedSkillPackage[],
  deps: { materialize: (destDir: string, bundle: FileBundle) => Promise<void> },
): Promise<ResolvedSkillPackage[]> {
  if (!skills.length) return skills;
  switch (provider ?? "claude") {
    case "claude": {
      const { bundle, mapping } = bundleEnabledSkills(skills, CLAUDE_SKILLS_DIR);
      await deps.materialize(CLAUDE_SKILLS_DIR, bundle);
      const byId = new Map(mapping.map((m) => [m.id, m.containerPath]));
      return skills.map((s) => ({ ...s, localPath: byId.get(s.id) ?? s.localPath }));
    }
    // opencode: .opencode/skills + permission.skill — added in the OpenCode spec
    default:
      return skills;
  }
}
