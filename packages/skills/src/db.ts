import type { Pool } from "pg";
import type { SkillPackage, SkillInstallStatus } from "@journeyman/core";

export class DuplicateSkillPackageError extends Error {
  constructor(name: string) {
    super(`Skill package name already in use: ${name}`);
    this.name = "DuplicateSkillPackageError";
  }
}

function rowToPackage(r: any): SkillPackage {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
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
    workspaceId: string;
    gitUrl: string;
    name: string;
    cliType?: string;
    shareCloneWith?: string;
  },
): Promise<SkillPackage> {
  try {
    if (input.shareCloneWith) {
      const { rows } = await pool.query(
        `INSERT INTO jm_skill_packages
            (workspace_id, git_url, name, cli_type, local_path, commit_sha, install_status)
         SELECT $1, $2, $3, $4, src.local_path, src.commit_sha, 'ready'
         FROM jm_skill_packages src
         WHERE src.id = $5
           AND src.workspace_id = $1
           AND src.git_url = $2
           AND src.install_status = 'ready'
         RETURNING *`,
        [input.workspaceId, input.gitUrl, input.name, input.cliType ?? 'claude', input.shareCloneWith],
      );
      if (!rows[0]) {
        throw new Error("Share-clone source not found, not in same workspace, or not ready");
      }
      return rowToPackage(rows[0]);
    }
    const { rows } = await pool.query(
      `INSERT INTO jm_skill_packages (workspace_id, git_url, name, cli_type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.workspaceId, input.gitUrl, input.name, input.cliType ?? 'claude'],
    );
    return rowToPackage(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') throw new DuplicateSkillPackageError(input.name);
    throw err;
  }
}

export async function listSkillPackages(pool: Pool, workspaceId: string): Promise<SkillPackage[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages WHERE workspace_id = $1 ORDER BY created_at`,
    [workspaceId],
  );
  return rows.map(rowToPackage);
}

export async function getSkillPackage(
  pool: Pool,
  id: string,
  workspaceId: string,
): Promise<SkillPackage | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
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
  workspaceId: string,
  enabledSkills: string[],
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE jm_skill_packages SET enabled_skills = $1, updated_at = now()
     WHERE id = $2 AND workspace_id = $3`,
    [enabledSkills, id, workspaceId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteSkillPackage(
  pool: Pool,
  id: string,
  workspaceId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_skill_packages WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listSkillPackagesForResolver(
  pool: Pool,
  workspaceId: string,
  cliType: string,
): Promise<SkillPackage[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
     WHERE workspace_id = $1 AND cli_type = $2 AND install_status = 'ready'`,
    [workspaceId, cliType],
  );
  return rows.map(rowToPackage);
}

export async function findShareableSkillPackage(
  pool: Pool,
  workspaceId: string,
  gitUrl: string,
): Promise<SkillPackage | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
      WHERE workspace_id = $1 AND git_url = $2 AND install_status = 'ready'
      ORDER BY created_at LIMIT 1`,
    [workspaceId, gitUrl],
  );
  return rows[0] ? rowToPackage(rows[0]) : null;
}

export async function updateSkillPackageStatusByPath(
  pool: Pool,
  localPath: string,
  patch: {
    installStatus: SkillInstallStatus;
    commitSha?: string;
    installError?: string;
  },
): Promise<void> {
  await pool.query(
    `UPDATE jm_skill_packages
     SET install_status = $2,
         commit_sha = COALESCE($3, commit_sha),
         install_error = $4,
         updated_at = now()
     WHERE local_path = $1`,
    [localPath, patch.installStatus, patch.commitSha ?? null, patch.installError ?? null],
  );
}

export async function countRowsByLocalPath(pool: Pool, localPath: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM jm_skill_packages WHERE local_path = $1`,
    [localPath],
  );
  return rows[0]?.n ?? 0;
}

export interface VisibleSkillRow {
  id: string;
  name: string;
  installStatus: SkillInstallStatus;
  enabledSkillCount: number;
}

export async function listVisibleSkillPackages(
  pool: Pool,
  workspaceId: string,
): Promise<VisibleSkillRow[]> {
  const { rows } = await pool.query(
    `SELECT id, name, install_status, enabled_skills
       FROM jm_skill_packages
      WHERE workspace_id = $1 AND install_status = 'ready'
      ORDER BY name`,
    [workspaceId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    installStatus: r.install_status,
    enabledSkillCount: (r.enabled_skills ?? []).length,
  }));
}

export async function fetchSkillPackagesByIds(
  pool: Pool,
  workspaceId: string,
  ids: string[],
): Promise<SkillPackage[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
      WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  return rows.map(rowToPackage);
}
