import { existsSync } from "node:fs";
import type { Pool } from "pg";
import type { ResolvedSkillPackage } from "@journeyman/core";
import { listSkillPackagesForResolver, updateSkillPackageStatus } from "./db.ts";
import { clonePackage, refreshPackage } from "./installer.ts";

export async function resolveSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string,
  cliType: string,
): Promise<ResolvedSkillPackage[]> {
  const packages = await listSkillPackagesForResolver(pool, orgId, userId, cliType);
  const resolved: ResolvedSkillPackage[] = [];

  for (const pkg of packages) {
    try {
      const result =
        pkg.localPath && existsSync(pkg.localPath)
          ? refreshPackage(pkg.localPath, pkg.gitUrl)
          : clonePackage(pkg.name, pkg.gitUrl);

      await updateSkillPackageStatus(pool, pkg.id, {
        installStatus: "ready",
        localPath: result.localPath,
        commitSha: result.commitSha,
      });

      const enabledSkills =
        pkg.enabledSkills.length > 0
          ? pkg.enabledSkills.filter((s) => result.discoveredSkills.includes(s))
          : result.discoveredSkills;

      resolved.push({
        id: pkg.id,
        name: pkg.name,
        localPath: result.localPath,
        enabledSkills,
        cliType: pkg.cliType,
      });
    } catch (err) {
      await updateSkillPackageStatus(pool, pkg.id, {
        installStatus: "error",
        installError: String(err),
      }).catch(() => {});
    }
  }

  return resolved;
}
