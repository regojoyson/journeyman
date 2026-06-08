import { bundleEnabledSkills } from "@journeyman/skills";
import type { FileBundle, ResolvedSkillPackage } from "@journeyman/core";

const CLAUDE_SKILLS_DIR = "/workspace/.journeyman/skills";
const OPENCODE_SKILLS_DIR = "/workspace/.opencode/skill";

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
    case "opencode": {
      // OpenCode discovers project skills under <projectRoot>/.opencode/skill; the
      // operation passes directory=/workspace so these are auto-loaded.
      const { bundle, mapping } = bundleEnabledSkills(skills, OPENCODE_SKILLS_DIR);
      await deps.materialize(OPENCODE_SKILLS_DIR, bundle);
      const byId = new Map(mapping.map((m) => [m.id, m.containerPath]));
      return skills.map((s) => ({ ...s, localPath: byId.get(s.id) ?? s.localPath }));
    }
    default:
      return skills;
  }
}
