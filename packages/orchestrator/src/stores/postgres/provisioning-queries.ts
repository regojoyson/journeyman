import type { Pool } from "pg";

/** IDs of runs that have been in "provisioning" for longer than `olderThanMs`. */
export async function findStuckProvisioningRuns(pool: Pool, olderThanMs: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id FROM jm_workflow_instances
       WHERE status = 'provisioning'
         AND created_at < now() - make_interval(secs => $1 / 1000.0)`,
    [olderThanMs],
  );
  return (rows as Array<{ id: string }>).map((r) => r.id);
}
