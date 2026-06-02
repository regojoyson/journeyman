import type { Queryable } from "./db.ts";
import type { DockerConnection } from "./backends/docker/docker-client.ts";

export interface SandboxRecord {
  runId: string;
  type: string;
  handle: string;
  volume: string | null;
  imageRef: string | null;
  owner: string | null;
  /** How to reach the daemon — so exec/teardown in other processes rebuild the right client. */
  connection: DockerConnection | null;
  status: "provisioning" | "active" | "destroyed";
}

export interface RecordSandboxArgs {
  runId: string;
  type: string;
  handle: string;
  volume?: string | null;
  imageRef?: string | null;
  owner?: string | null;
  connection?: DockerConnection | null;
}

const COLS = "run_id, type, handle, volume, image_ref, owner, connection, status";

function rowToSandbox(r: Record<string, any>): SandboxRecord {
  return {
    runId: r.run_id,
    type: r.type,
    handle: r.handle,
    volume: r.volume ?? null,
    imageRef: r.image_ref ?? null,
    owner: r.owner ?? null,
    connection: (r.connection ?? null) as DockerConnection | null,
    status: r.status,
  };
}

export async function recordSandbox(db: Queryable, args: RecordSandboxArgs): Promise<void> {
  await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, volume, image_ref, owner, connection)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       type = EXCLUDED.type, handle = EXCLUDED.handle, volume = EXCLUDED.volume,
       image_ref = EXCLUDED.image_ref, owner = EXCLUDED.owner, connection = EXCLUDED.connection, status = 'active'`,
    [
      args.runId, args.type, args.handle, args.volume ?? null, args.imageRef ?? null, args.owner ?? null,
      args.connection ? JSON.stringify(args.connection) : null,
    ],
  );
}

export async function getSandbox(db: Queryable, runId: string): Promise<SandboxRecord | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandbox_instances WHERE run_id = $1`,
    [runId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}

export async function markSandboxDestroyed(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `UPDATE jm_sandbox_instances SET status = 'destroyed', destroyed_at = now() WHERE run_id = $1`,
    [runId],
  );
}

export async function listActiveSandboxes(db: Queryable): Promise<SandboxRecord[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandbox_instances WHERE status = 'active'`,
  );
  return rows.map(rowToSandbox);
}

/**
 * Insert a provisioning row only if one does not already exist for this run.
 * Returns true if THIS caller won the race (must provision); false if another
 * worker already claimed it (caller should waitActive instead).
 *
 * run_id is the PRIMARY KEY so ON CONFLICT (run_id) relies on the PK constraint
 * — no separate UNIQUE index is needed.
 */
export async function claimSandbox(
  db: Queryable,
  row: { runId: string; type: string; owner: string },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner)
     VALUES ($1, $2, '', 'provisioning', $3)
     ON CONFLICT (run_id) DO NOTHING
     RETURNING run_id`,
    [row.runId, row.type, row.owner],
  );
  return r.rows.length > 0;
}

/** Mark a previously claimed sandbox active with its real handle/volume/connection. */
export async function markSandboxActive(
  db: Queryable,
  runId: string,
  patch: { handle: string; volume?: string | null; imageRef?: string | null; connection?: unknown },
): Promise<void> {
  await db.query(
    `UPDATE jm_sandbox_instances
       SET status = 'active', handle = $2, volume = $3, image_ref = $4, connection = $5::jsonb
     WHERE run_id = $1`,
    [runId, patch.handle, patch.volume ?? null, patch.imageRef ?? null,
     patch.connection != null ? JSON.stringify(patch.connection) : null],
  );
}
