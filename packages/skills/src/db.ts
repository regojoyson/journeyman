import type { Pool } from "pg";
import type { SkillPackage, SkillInstallStatus } from "@journeyman/core";

export class DuplicateSkillPackageError extends Error {
  constructor(gitUrl: string) {
    super(`Skill package already added: ${gitUrl}`);
    this.name = "DuplicateSkillPackageError";
  }
}

function rowToPackage(r: any): SkillPackage {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    gitUrl: r.git_url,
    name: r.name,
    localPath: r.local_path ?? undefined,
    commitSha: r.commit_sha ?? undefined,
    installStatus: r.install_status,
    installError: r.install_error ?? undefined,
    enabledSkills: r.enabled_skills ?? [],
    cliType: r.cli_type,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertSkillPackage(
  pool: Pool,
  input: {
    orgId: string;
    userId: string | null;
    scope: 'user' | 'org';
    gitUrl: string;
    name: string;
    cliType?: string;
  },
): Promise<SkillPackage> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_skill_packages (scope, user_id, org_id, git_url, name, cli_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.scope, input.userId, input.orgId, input.gitUrl, input.name, input.cliType ?? 'claude'],
    );
    return rowToPackage(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') throw new DuplicateSkillPackageError(input.gitUrl);
    throw err;
  }
}

export async function listSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string | null,
): Promise<SkillPackage[]> {
  const { rows } = userId
    ? await pool.query(
        `SELECT * FROM jm_skill_packages WHERE org_id = $1 AND user_id = $2 ORDER BY created_at`,
        [orgId, userId],
      )
    : await pool.query(
        `SELECT * FROM jm_skill_packages WHERE org_id = $1 AND user_id IS NULL ORDER BY created_at`,
        [orgId],
      );
  return rows.map(rowToPackage);
}

export async function getSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<SkillPackage | null> {
  const { rows } = userId
    ? await pool.query(
        `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id = $3`,
        [id, orgId, userId],
      )
    : await pool.query(
        `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id IS NULL`,
        [id, orgId],
      );
  return rows[0] ? rowToPackage(rows[0]) : null;
}

export async function updateSkillPackageStatus(
  pool: Pool,
  id: string,
  patch: {
    installStatus: SkillInstallStatus;
    localPath?: string;
    commitSha?: string;
    installError?: string;
  },
): Promise<void> {
  await pool.query(
    `UPDATE jm_skill_packages
     SET install_status = $2, local_path = COALESCE($3, local_path),
         commit_sha = COALESCE($4, commit_sha), install_error = $5, updated_at = now()
     WHERE id = $1`,
    [id, patch.installStatus, patch.localPath ?? null, patch.commitSha ?? null, patch.installError ?? null],
  );
}

export async function updateEnabledSkills(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
  enabledSkills: string[],
): Promise<boolean> {
  const { rowCount } = userId
    ? await pool.query(
        `UPDATE jm_skill_packages SET enabled_skills = $1, updated_at = now()
         WHERE id = $2 AND org_id = $3 AND user_id = $4`,
        [enabledSkills, id, orgId, userId],
      )
    : await pool.query(
        `UPDATE jm_skill_packages SET enabled_skills = $1, updated_at = now()
         WHERE id = $2 AND org_id = $3 AND user_id IS NULL`,
        [enabledSkills, id, orgId],
      );
  return (rowCount ?? 0) > 0;
}

export async function deleteSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { rowCount } = userId
    ? await pool.query(
        `DELETE FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id = $3`,
        [id, orgId, userId],
      )
    : await pool.query(
        `DELETE FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id IS NULL`,
        [id, orgId],
      );
  return (rowCount ?? 0) > 0;
}

export async function listSkillPackagesForResolver(
  pool: Pool,
  orgId: string,
  userId: string,
  cliType: string,
): Promise<SkillPackage[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
     WHERE org_id = $1
       AND cli_type = $2
       AND install_status = 'ready'
       AND (
         (scope = 'org' AND user_id IS NULL)
         OR (scope = 'user' AND user_id = $3)
       )`,
    [orgId, cliType, userId],
  );
  return rows.map(rowToPackage);
}

export interface PromotableSkillRow {
  id: string;
  name: string;
  gitUrl: string;
  ownerId: string;
  ownerEmail: string;
  enabledSkillCount: number;
  updatedAt: string;
}

export async function listPromotableSkillPackages(
  pool: Pool,
  orgId: string,
): Promise<PromotableSkillRow[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.git_url, s.user_id, s.enabled_skills, s.updated_at,
            u.username AS owner_email
       FROM jm_skill_packages s
       JOIN jm_users u ON u.id = s.user_id
      WHERE s.org_id = $1 AND s.user_id IS NOT NULL
      ORDER BY u.username, s.name`,
    [orgId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    gitUrl: r.git_url,
    ownerId: r.user_id,
    ownerEmail: r.owner_email,
    enabledSkillCount: (r.enabled_skills ?? []).length,
    updatedAt: r.updated_at,
  }));
}

export async function promoteSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
): Promise<SkillPackage | null> {
  const pkg = await pool.query(
    `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND scope = 'user'`,
    [id, orgId],
  );
  if (!pkg.rows[0]) return null;
  const src = rowToPackage(pkg.rows[0]);
  await deleteSkillPackage(pool, id, orgId, src.userId ?? null);
  return insertSkillPackage(pool, {
    orgId,
    userId: null,
    scope: 'org',
    gitUrl: src.gitUrl,
    name: src.name,
    cliType: src.cliType,
  });
}
