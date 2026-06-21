#!/usr/bin/env node
// scripts/backfill-token-cost.mjs — one-time: fill jm_token_usage.cost_usd from jm_model_pricing.
// Effective-dated: each row is priced at the rate active when it ran. Re-runnable; only NULLs touched.
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: url });

const SQL = `
  UPDATE jm_token_usage u SET cost_usd = (
      COALESCE(u.input_tokens,0)/1e6 * COALESCE(p.input_per_1m,0)
    + COALESCE(u.output_tokens,0)/1e6 * COALESCE(p.output_per_1m,0)
    + COALESCE(u.cache_read_tokens,0)/1e6 * COALESCE(p.cache_read_per_1m,0)
    + COALESCE(u.cache_creation_tokens,0)/1e6 * COALESCE(p.cache_creation_per_1m,0)
    + COALESCE(u.reasoning_tokens,0)/1e6 * COALESCE(p.reasoning_per_1m,0)
  )
  FROM LATERAL (
    SELECT * FROM jm_model_pricing mp
    WHERE mp.org_id = u.org_id AND mp.provider = u.provider AND mp.model = u.model
      AND mp.effective_from <= u.created_at
      AND (mp.effective_to IS NULL OR u.created_at < mp.effective_to)
    ORDER BY mp.effective_from DESC LIMIT 1
  ) p
  WHERE u.cost_usd IS NULL;`;

async function main() {
  const { rowCount } = await pool.query(SQL);
  console.log(`backfilled cost_usd on ${rowCount} rows`);
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
