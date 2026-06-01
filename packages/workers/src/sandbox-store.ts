import type { Queryable } from "./db.ts";

export interface SandboxRecord {
  runId: string;
  type: string;
  handle: string;
  volume: string | null;
  imageRef: string | null;
  owner: string | null;
  status: "active" | "destroyed";
}

export interface RecordSandboxArgs {
  runId: string;
  type: string;
  handle: string;
  volume?: string | null;
  imageRef?: string | null;
  owner?: string | null;
}

function rowToSandbox(r: Record<string, any>): SandboxRecord {
  return {
    runId: r.run_id,
    type: r.type,
    handle: r.handle,
    volume: r.volume ?? null,
    imageRef: r.image_ref ?? null,
    owner: r.owner ?? null,
    status: r.status,
  };
}

export async function recordSandbox(db: Queryable, args: RecordSandboxArgs): Promise<void> {
  await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, volume, image_ref, owner)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (run_id) DO UPDATE SET
       type = EXCLUDED.type, handle = EXCLUDED.handle, volume = EXCLUDED.volume,
       image_ref = EXCLUDED.image_ref, owner = EXCLUDED.owner, status = 'active'`,
    [args.runId, args.type, args.handle, args.volume ?? null, args.imageRef ?? null, args.owner ?? null],
  );
}

export async function getSandbox(db: Queryable, runId: string): Promise<SandboxRecord | null> {
  const { rows } = await db.query(
    `SELECT run_id, type, handle, volume, image_ref, owner, status FROM jm_sandbox_instances WHERE run_id = $1`,
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
    `SELECT run_id, type, handle, volume, image_ref, owner, status FROM jm_sandbox_instances WHERE status = 'active'`,
  );
  return rows.map(rowToSandbox);
}
