import type { Pool } from "pg";
import type { ModelPricing, ModelPricingCreateInput, ModelPricingUpdateInput, ModelPriceInput } from "@journeyman/core";

const RATE_KEYS = ["inputPer1m", "outputPer1m", "cacheReadPer1m", "cacheCreationPer1m", "reasoningPer1m"] as const;

export function hasAnyRate(p: ModelPriceInput | undefined): boolean {
  return !!p && RATE_KEYS.some((k) => typeof p[k] === "number");
}

/** Compare an existing active price's rates to a submitted input. null and undefined are equal. */
export function ratesEqual(active: ModelPricing, input: ModelPriceInput): boolean {
  return RATE_KEYS.every((k) => (active[k] ?? null) === (input[k] ?? null));
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function rowToPricing(r: any): ModelPricing {
  return {
    id: r.id,
    orgId: r.org_id,
    provider: r.provider,
    vendor: r.vendor ?? undefined,
    model: r.model,
    inputPer1m: num(r.input_per_1m),
    outputPer1m: num(r.output_per_1m),
    cacheReadPer1m: num(r.cache_read_per_1m),
    cacheCreationPer1m: num(r.cache_creation_per_1m),
    reasoningPer1m: num(r.reasoning_per_1m),
    currency: r.currency,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function newId(): string {
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns { id, params } for the INSERT (column order documented in insertModelPricing). */
export function buildInsertParams(orgId: string, input: ModelPricingCreateInput) {
  const id = newId();
  const params = [
    id, orgId, input.provider, input.vendor ?? null, input.model,
    input.inputPer1m ?? null, input.outputPer1m ?? null, input.cacheReadPer1m ?? null,
    input.cacheCreationPer1m ?? null, input.reasoningPer1m ?? null,
    input.currency ?? "USD", input.effectiveFrom ?? null,
  ];
  return { id, params };
}

export async function listModelPricingByOrg(pool: Pool, orgId: string): Promise<ModelPricing[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing WHERE org_id = $1
     ORDER BY provider, model, effective_from DESC`,
    [orgId],
  );
  return rows.map(rowToPricing);
}

export async function getModelPricing(pool: Pool, orgId: string, id: string): Promise<ModelPricing | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing WHERE id = $1 AND org_id = $2`, [id, orgId],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

/**
 * Insert a new price row. If an active (effective_to IS NULL) row exists for the same
 * (org, provider, model), close it at the new row's effective_from so there is exactly one
 * active price at a time.
 */
export async function insertModelPricing(
  pool: Pool, orgId: string, input: ModelPricingCreateInput,
): Promise<ModelPricing> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const effFrom = input.effectiveFrom ?? new Date().toISOString();
    await client.query(
      `UPDATE jm_model_pricing SET effective_to = $4, updated_at = now()
       WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL`,
      [orgId, input.provider, input.model, effFrom],
    );
    const { params } = buildInsertParams(orgId, { ...input, effectiveFrom: effFrom });
    const { rows } = await client.query(
      `INSERT INTO jm_model_pricing
         (id, org_id, provider, vendor, model, input_per_1m, output_per_1m, cache_read_per_1m,
          cache_creation_per_1m, reasoning_per_1m, currency, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      params,
    );
    await client.query("COMMIT");
    return rowToPricing(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Patch rate/currency fields on an existing row in place (does not version). */
export async function updateModelPricing(
  pool: Pool, orgId: string, id: string, patch: ModelPricingUpdateInput,
): Promise<ModelPricing | null> {
  const existing = await getModelPricing(pool, orgId, id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  const { rows } = await pool.query(
    `UPDATE jm_model_pricing SET
       vendor = $3, input_per_1m = $4, output_per_1m = $5, cache_read_per_1m = $6,
       cache_creation_per_1m = $7, reasoning_per_1m = $8, currency = $9, updated_at = now()
     WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, orgId, next.vendor ?? null, next.inputPer1m, next.outputPer1m, next.cacheReadPer1m,
     next.cacheCreationPer1m, next.reasoningPer1m, next.currency],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

export async function deleteModelPricing(pool: Pool, orgId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_model_pricing WHERE id = $1 AND org_id = $2`, [id, orgId],
  );
  return (rowCount ?? 0) > 0;
}

/** The active (effective_to IS NULL) price for (org, provider, model), or null. */
export async function getActivePrice(
  pool: Pool, orgId: string, provider: string, model: string,
): Promise<ModelPricing | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_model_pricing
     WHERE org_id = $1 AND provider = $2 AND model = $3 AND effective_to IS NULL
     LIMIT 1`,
    [orgId, provider, model],
  );
  return rows[0] ? rowToPricing(rows[0]) : null;
}

/**
 * Set the active price for (org, provider, model) from a form input. No-op when no rate is set
 * or when the rates match the current active price. Otherwise supersedes via insertModelPricing.
 */
export async function upsertActivePrice(
  pool: Pool, orgId: string, provider: string, model: string, input: ModelPriceInput | undefined,
): Promise<void> {
  if (!hasAnyRate(input)) return;
  const active = await getActivePrice(pool, orgId, provider, model);
  if (active && ratesEqual(active, input!)) return;
  await insertModelPricing(pool, orgId, {
    provider, model,
    inputPer1m: input!.inputPer1m ?? null, outputPer1m: input!.outputPer1m ?? null,
    cacheReadPer1m: input!.cacheReadPer1m ?? null, cacheCreationPer1m: input!.cacheCreationPer1m ?? null,
    reasoningPer1m: input!.reasoningPer1m ?? null, currency: input!.currency,
  });
}
