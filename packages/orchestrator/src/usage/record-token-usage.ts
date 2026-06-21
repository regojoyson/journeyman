import type { Pool } from "pg";
import { createLogger, type TokenUsage } from "@journeyman/core";

const log = createLogger("usage:record");

export interface RecordTokenUsageArgs {
  workspaceId: string | null;
  orgId: string | null;
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowName: string | null;
  workflowInstanceId: string;
  nodeId: string;
  stepType: string;
  stepName: string | null;
  attempt: number;
  agentId: string | null;
  agentName: string | null;
  triggeredByUserId: string | null;
  outcome: "success" | "error" | "aborted";
  provider: string;
  /** Used as the model on a usage_reported=false row when the provider reported nothing. */
  requestedModel: string | null;
  usage: TokenUsage[];
}

const INSERT = `
  INSERT INTO jm_token_usage (
    workspace_id, org_id, workflow_id, workflow_version_id, workflow_name,
    workflow_instance_id, node_id, step_type, step_name, attempt,
    agent_id, agent_name, triggered_by_user_id, provider, vendor, model, outcome,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    reasoning_tokens, total_tokens, usage_reported, raw_usage
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
  )
  ON CONFLICT (workflow_instance_id, node_id, attempt, provider, COALESCE(model, '')) DO NOTHING`;

/**
 * Append one jm_token_usage row per model used. Empty usage ⇒ a single usage_reported=false
 * row. Never throws (best-effort logging). Returns the number of rows actually inserted
 * (0 on a duplicate / no pool), so callers can gate downstream rollups on a real insert.
 */
export async function recordTokenUsage(
  pool: Pool | null | undefined,
  args: RecordTokenUsageArgs,
): Promise<number> {
  if (!pool) return 0;
  const rows: Array<{ u: Partial<TokenUsage>; reported: boolean }> = args.usage.length
    ? args.usage.map((u) => ({ u, reported: true }))
    : [{ u: { provider: args.provider, model: args.requestedModel ?? undefined }, reported: false }];

  let inserted = 0;
  try {
    for (const { u, reported } of rows) {
      const res = await pool.query(INSERT, [
        args.workspaceId, args.orgId, args.workflowId, args.workflowVersionId, args.workflowName,
        args.workflowInstanceId, args.nodeId, args.stepType, args.stepName, args.attempt,
        args.agentId, args.agentName, args.triggeredByUserId, u.provider ?? args.provider,
        u.vendor ?? null, u.model ?? args.requestedModel ?? null, args.outcome,
        u.inputTokens ?? null, u.outputTokens ?? null, u.cacheReadTokens ?? null,
        u.cacheCreationTokens ?? null, u.reasoningTokens ?? null, u.totalTokens ?? null,
        reported, u.raw != null ? JSON.stringify(u.raw) : null,
      ]);
      inserted += res.rowCount ?? 0;
    }
  } catch (err) {
    log.warn({ err: (err as Error)?.message, instance: args.workflowInstanceId, node: args.nodeId }, "recordTokenUsage failed (ignored)");
    return inserted;
  }
  return inserted;
}
