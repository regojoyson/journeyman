import type { Queryable } from "./db.ts";
import type { DockerConnection } from "./backends/docker/docker-client.ts";
import type { WindowsAgentConnection } from "./backends/windows/windows-agent-client.ts";

/** Any backend's persisted connection (so any process can rebuild its client). */
export type SandboxConnection = DockerConnection | WindowsAgentConnection;

export interface SandboxInstanceRecord {
  runId: string;
  type: string;
  handle: string;
  volume: string | null;
  imageRef: string | null;
  owner: string | null;
  /** How to reach the target — so exec/teardown in other processes rebuild the right client. */
  connection: SandboxConnection | null;
  status: "provisioning" | "active" | "destroyed";
}

export interface RecordSandboxInstanceArgs {
  runId: string;
  type: string;
  handle: string;
  volume?: string | null;
  imageRef?: string | null;
  owner?: string | null;
  connection?: SandboxConnection | null;
}

const COLS = "run_id, type, handle, volume, image_ref, owner, connection, status";

function rowToSandboxInstance(r: Record<string, any>): SandboxInstanceRecord {
  return {
    runId: r.run_id,
    type: r.type,
    handle: r.handle,
    volume: r.volume ?? null,
    imageRef: r.image_ref ?? null,
    owner: r.owner ?? null,
    connection: (r.connection ?? null) as SandboxConnection | null,
    status: r.status,
  };
}

export async function recordSandboxInstance(db: Queryable, args: RecordSandboxInstanceArgs): Promise<void> {
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

export async function getSandboxInstance(db: Queryable, runId: string): Promise<SandboxInstanceRecord | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandbox_instances WHERE run_id = $1`,
    [runId],
  );
  return rows[0] ? rowToSandboxInstance(rows[0]) : null;
}

export async function markSandboxInstanceDestroyed(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `UPDATE jm_sandbox_instances SET status = 'destroyed', destroyed_at = now() WHERE run_id = $1`,
    [runId],
  );
}

export async function listActiveSandboxInstances(db: Queryable): Promise<SandboxInstanceRecord[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM jm_sandbox_instances WHERE status = 'active'`,
  );
  return rows.map(rowToSandboxInstance);
}

/**
 * Insert a provisioning row only if one does not already exist for this run.
 * Returns true if THIS caller won the race (must provision); false if another
 * worker already claimed it (caller should waitActive instead).
 *
 * run_id is the PRIMARY KEY so ON CONFLICT (run_id) relies on the PK constraint
 * — no separate UNIQUE index is needed.
 */
export async function claimSandboxInstance(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId?: string | null },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner, sandbox_id)
     VALUES ($1, $2, '', 'provisioning', $3, $4)
     ON CONFLICT (run_id) DO NOTHING
     RETURNING run_id`,
    [row.runId, row.type, row.owner, row.sandboxId ?? null],
  );
  return r.rows.length > 0;
}

/** Thrown by claimSandboxInstanceWithCapacity when the sandbox is at its concurrency limit. */
export class SandboxAtCapacityError extends Error {
  constructor(message = "sandbox at capacity") {
    super(message);
    this.name = "SandboxAtCapacityError";
  }
}

/**
 * Claim a sandbox slot atomically. With no limit, delegates to claimSandboxInstance
 * (lock-free). With a limit, a single advisory-locked statement counts active+
 * provisioning rows for the sandbox and inserts only if under the cap.
 *
 * Returns true if THIS caller won the claim, false if another worker already
 * holds this run (caller should waitActive). Throws SandboxAtCapacityError when
 * the sandbox is full.
 */
export async function claimSandboxInstanceWithCapacity(
  db: Queryable,
  row: { runId: string; type: string; owner: string; sandboxId: string; limit: number | null },
): Promise<boolean> {
  if (row.limit == null || row.limit <= 0) {
    return claimSandboxInstance(db, row);
  }
  const { rows } = await db.query(
    `WITH lk AS (
       SELECT pg_advisory_xact_lock(hashtext('jm_sbx_cap:' || $4::text)) AS locked
     ),
     cap AS (
       SELECT count(*) AS n
       FROM jm_sandbox_instances i, lk
       WHERE i.sandbox_id = $4::uuid AND i.status IN ('provisioning','active')
     ),
     ins AS (
       INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner, sandbox_id)
       SELECT $1, $2, '', 'provisioning', $3, $4::uuid
       FROM cap
       WHERE cap.n < $5
       ON CONFLICT (run_id) DO NOTHING
       RETURNING run_id
     )
     SELECT (SELECT count(*) FROM ins) AS inserted,
            EXISTS (SELECT 1 FROM jm_sandbox_instances WHERE run_id = $1) AS run_exists`,
    [row.runId, row.type, row.owner, row.sandboxId, row.limit],
  );
  const inserted = Number(rows[0]?.inserted ?? 0);
  const runExists = Boolean(rows[0]?.run_exists);
  if (inserted > 0) return true;       // won the claim
  if (runExists) return false;         // another worker holds this run → waitActive
  throw new SandboxAtCapacityError();  // blocked by capacity
}

/**
 * Release an un-provisioned claim (provision failed before reaching 'active').
 * DELETEs the row so the slot frees immediately AND a Conductor retry can
 * re-claim cleanly. The handle='' guard guarantees we never remove a live unit.
 */
export async function releaseSandboxClaim(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `DELETE FROM jm_sandbox_instances
       WHERE run_id = $1 AND status = 'provisioning' AND handle = ''`,
    [runId],
  );
}

/** Mark a previously claimed sandbox active with its real handle/volume/connection. */
export async function markSandboxInstanceActive(
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
