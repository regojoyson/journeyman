import type { Pool } from "pg";

/**
 * IDs of runs whose sandbox row has been stuck in `status = 'provisioning'`
 * for longer than `olderThanMs` milliseconds.
 *
 * Previously this queried `jm_workflow_instances.status = 'provisioning'`, which
 * was unreliable once the worker became responsible for provisioning (the run
 * status transitions to 'running' before the sandbox reaches 'active').
 * We now look at the sandbox record's status + age instead.
 */
export async function findStuckProvisioningRuns(pool: Pool, olderThanMs: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT si.run_id AS id
       FROM jm_sandbox_instances si
      WHERE si.status = 'provisioning'
        AND si.created_at < now() - make_interval(secs => $1 / 1000.0)`,
    [olderThanMs],
  );
  return (rows as Array<{ id: string }>).map((r) => r.id);
}
