import { create as tarCreate } from "tar";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import type { FileBundle, ResolvedSkillPackage } from "@journeyman/core";

export interface SkillBundleResult {
  bundle: FileBundle;
  /** in-container path for each package root (for localPath rewrite). */
  mapping: Array<{ id: string; containerPath: string }>;
}

/**
 * Pack each resolved skill *package* directory into one tar, placed under
 * `<destDir>/<packageDirName>/...`. Returns the per-package in-container path so
 * the caller can rewrite ResolvedSkillPackage.localPath to the materialized root.
 */
export function bundleEnabledSkills(
  skills: ResolvedSkillPackage[],
  destDir: string,
): SkillBundleResult {
  const dirs: string[] = [];
  const mapping: Array<{ id: string; containerPath: string }> = [];
  for (const s of skills) {
    if (!s.localPath) continue;
    const dirName = basename(s.localPath);
    dirs.push(s.localPath);
    mapping.push({ id: s.id, containerPath: `${destDir}/${dirName}` });
  }
  // tar entries keyed by the package dir basename so they extract as <destDir>/<dirName>/...
  const tar = tarCreate(
    { cwd: dirs.length ? dirsCommonParent(dirs) : process.cwd(), portable: true },
    dirs.map((d) => basename(d)),
  ) as unknown as Readable;
  return { bundle: { tar }, mapping };
}

function dirsCommonParent(dirs: string[]): string {
  // All cached skill packages live under the same SKILLS_CACHE_DIR; use that parent.
  const first = dirs[0];
  return first.slice(0, first.lastIndexOf("/"));
}
