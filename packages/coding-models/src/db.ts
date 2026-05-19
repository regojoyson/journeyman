import type { Pool } from "pg";
import type {
  CodingModel,
  CodingModelCreateInput,
  CodingModelUpdateInput,
} from "@journeyman/core";

export class DuplicateCodingModelError extends Error {
  constructor(provider: string, modelId: string) {
    super(`Coding model already exists: ${provider}/${modelId}`);
    this.name = "DuplicateCodingModelError";
  }
}

function rowToModel(r: any): CodingModel {
  return {
    id: r.id,
    provider: r.provider,
    modelId: r.model_id,
    label: r.label,
    description: r.description ?? undefined,
    sortOrder: r.sort_order,
    enabled: r.enabled,
    deprecated: r.deprecated,
    isDefault: r.is_default,
    supportsThinking: r.supports_thinking,
    contextWindow: r.context_window ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function newId(): string {
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function insertCodingModel(
  pool: Pool,
  input: CodingModelCreateInput,
): Promise<CodingModel> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.isDefault) {
      await client.query(
        `UPDATE jm_coding_models SET is_default = false, updated_at = now()
         WHERE provider = $1 AND is_default = true`,
        [input.provider],
      );
    }
    const id = newId();
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO jm_coding_models
           (id, provider, model_id, label, description, sort_order, enabled,
            deprecated, is_default, supports_thinking, context_window)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id,
          input.provider,
          input.modelId,
          input.label,
          input.description ?? null,
          input.sortOrder ?? 0,
          input.enabled ?? true,
          input.deprecated ?? false,
          input.isDefault ?? false,
          input.supportsThinking ?? false,
          input.contextWindow ?? null,
        ],
      ));
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new DuplicateCodingModelError(input.provider, input.modelId);
      }
      throw err;
    }
    await client.query("COMMIT");
    return rowToModel(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getCodingModel(pool: Pool, id: string): Promise<CodingModel | null> {
  const { rows } = await pool.query(`SELECT * FROM jm_coding_models WHERE id = $1`, [id]);
  return rows[0] ? rowToModel(rows[0]) : null;
}

export async function listAllCodingModels(pool: Pool): Promise<CodingModel[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models ORDER BY provider, sort_order, label`,
  );
  return rows.map(rowToModel);
}

export async function listEnabledCodingModelsByProvider(
  pool: Pool,
  provider: string,
): Promise<CodingModel[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models
     WHERE provider = $1 AND enabled = true
     ORDER BY sort_order, label`,
    [provider],
  );
  return rows.map(rowToModel);
}

export async function findDefaultCodingModel(
  pool: Pool,
  provider: string,
): Promise<CodingModel | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models
     WHERE provider = $1 AND enabled = true AND is_default = true
     LIMIT 1`,
    [provider],
  );
  return rows[0] ? rowToModel(rows[0]) : null;
}

export async function updateCodingModel(
  pool: Pool,
  id: string,
  patch: CodingModelUpdateInput,
): Promise<CodingModel | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existingRows } = await client.query(
      `SELECT * FROM jm_coding_models WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existingRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const existing = rowToModel(existingRows[0]);
    const next = { ...existing, ...patch };
    if (patch.isDefault === true && !existing.isDefault) {
      await client.query(
        `UPDATE jm_coding_models SET is_default = false, updated_at = now()
         WHERE provider = $1 AND is_default = true AND id <> $2`,
        [next.provider, id],
      );
    }
    let rows;
    try {
      ({ rows } = await client.query(
        `UPDATE jm_coding_models SET
           provider = $2,
           model_id = $3,
           label = $4,
           description = $5,
           sort_order = $6,
           enabled = $7,
           deprecated = $8,
           is_default = $9,
           supports_thinking = $10,
           context_window = $11,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          next.provider,
          next.modelId,
          next.label,
          next.description ?? null,
          next.sortOrder,
          next.enabled,
          next.deprecated,
          next.isDefault,
          next.supportsThinking,
          next.contextWindow ?? null,
        ],
      ));
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new DuplicateCodingModelError(next.provider, next.modelId);
      }
      throw err;
    }
    await client.query("COMMIT");
    return rowToModel(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCodingModel(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM jm_coding_models WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
