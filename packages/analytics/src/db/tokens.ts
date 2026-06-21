import type { Pool } from "pg";
import type { TokenStat } from "@journeyman/core";

export async function tokenStat(pool: Pool, wsId: string, since: Date): Promise<TokenStat> {
  const { rows } = await pool.query(
    `SELECT provider,
            COALESCE(vendor, 'unknown') AS vendor,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens
       FROM jm_token_usage
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY provider, COALESCE(vendor, 'unknown')`,
    [wsId, since],
  );
  const byProvider: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const t = Number(r.tokens);
    total += t;
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + t;
    byVendor[r.vendor] = (byVendor[r.vendor] ?? 0) + t;
  }
  return { total, byProvider, byVendor, costUsd: null };
}
