export type UsageDimension =
  | "model" | "provider" | "vendor" | "agent" | "workflow" | "workflow_version" | "step" | "day";

export interface UsageFilters {
  wsId: string;
  from?: string;
  to?: string;
  provider?: string;
  vendor?: string;
  model?: string;
  agentId?: string;
  workflowId?: string;
  instanceId?: string;
  outcome?: string;
}

/** GROUP BY expression per dimension. Whitelisted — never interpolate caller input. */
export const DIMENSION_COLUMNS: Record<UsageDimension, string> = {
  model: "provider, model",
  provider: "provider",
  vendor: "vendor",
  agent: "agent_id, agent_name",
  workflow: "workflow_id, workflow_name",
  workflow_version: "workflow_version_id",
  step: "step_type",
  day: "date_trunc('day', created_at)",
};

const SUMS = `
  COUNT(*)::bigint AS rows,
  COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
  COALESCE(SUM(cache_read_tokens),0)::bigint AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens),0)::bigint AS cache_creation_tokens,
  COALESCE(SUM(reasoning_tokens),0)::bigint AS reasoning_tokens,
  COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,
  SUM(cost_usd) AS cost_usd`;

/** Build the shared WHERE clause + params. Workspace scope is always $1. */
function buildWhere(filters: UsageFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [filters.wsId];
  const clauses: string[] = ["workspace_id = $1"];
  const add = (col: string, val: unknown, op = "=") => {
    if (val === undefined || val === null || val === "") return;
    params.push(val);
    clauses.push(`${col} ${op} $${params.length}`);
  };
  add("provider", filters.provider);
  add("vendor", filters.vendor);
  add("model", filters.model);
  add("agent_id", filters.agentId);
  add("workflow_id", filters.workflowId);
  add("workflow_instance_id", filters.instanceId);
  add("outcome", filters.outcome);
  add("created_at", filters.from, ">=");
  add("created_at", filters.to, "<=");
  return { where: clauses.join(" AND "), params };
}

/** Grouped totals for GET /usage/by/:dimension. */
export function buildUsageAggregateQuery(
  dimension: UsageDimension,
  filters: UsageFilters,
): { sql: string; params: unknown[] } {
  const group = DIMENSION_COLUMNS[dimension];
  if (!group) throw new Error(`unknown usage dimension: ${dimension}`);
  const { where, params } = buildWhere(filters);
  const sql =
    `SELECT ${group} AS group_key, ${SUMS} FROM jm_token_usage` +
    ` WHERE ${where} GROUP BY ${group} ORDER BY total_tokens DESC`;
  return { sql, params };
}

/** Totals across the filtered set (no GROUP BY) — for GET /usage. */
export function buildUsageTotalsQuery(filters: UsageFilters): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(filters);
  return { sql: `SELECT ${SUMS} FROM jm_token_usage WHERE ${where}`, params };
}
