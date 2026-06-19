import { existsSync } from "node:fs";
import type { Pool } from "pg";
import type { ResolvedSkillPackage, SkillCliType } from "@journeyman/core";
import {
  fetchSkillPackagesByIds,
  listSkillPackagesForResolver,
  updateSkillPackageStatus,
} from "./db.ts";
import { clonePackage, refreshPackage } from "./installer.ts";

export class MissingSkillPackagesError extends Error {
  constructor(public missing: string[]) {
    super(`Skill packages not found: ${missing.join(", ")}`);
    this.name = "MissingSkillPackagesError";
  }
}

async function resolveOne(
  pool: Pool,
  pkg: { id: string; name: string; gitUrl: string; localPath?: string; enabledSkills: string[]; cliType: SkillCliType },
): Promise<ResolvedSkillPackage | null> {
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

    return {
      id: pkg.id,
      name: pkg.name,
      localPath: result.localPath,
      enabledSkills,
      cliType: pkg.cliType,
    };
  } catch (err) {
    await updateSkillPackageStatus(pool, pkg.id, {
      installStatus: "error",
      installError: String(err),
    }).catch(() => {});
    return null;
  }
}

export async function resolveSkillPackages(
  pool: Pool,
  workspaceId: string,
  cliType: string,
): Promise<ResolvedSkillPackage[]> {
  const packages = await listSkillPackagesForResolver(pool, workspaceId, cliType);
  const out: ResolvedSkillPackage[] = [];
  for (const pkg of packages) {
    const r = await resolveOne(pool, pkg);
    if (r) out.push(r);
  }
  return out;
}

export async function resolveSkillPackagesByIds(
  pool: Pool,
  ctx: { workspaceId?: string | null },
  packageIds: string[],
  cliType: string,
): Promise<ResolvedSkillPackage[]> {
  // No workspace in context (e.g. runtime before the Flows cutover wires it) →
  // skills are workspace-only, so nothing resolves.
  if (packageIds.length === 0 || !ctx.workspaceId) return [];
  const found = await fetchSkillPackagesByIds(pool, ctx.workspaceId, packageIds);
  const byId = new Map(found.map((p) => [p.id, p]));
  const missing = packageIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new MissingSkillPackagesError(missing);

  const out: ResolvedSkillPackage[] = [];
  for (const pkg of found) {
    if (pkg.cliType !== cliType) continue;
    const r = await resolveOne(pool, pkg);
    if (r) out.push(r);
  }
  return out;
}
