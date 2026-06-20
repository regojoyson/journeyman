import { readPath } from "@journeyman/webhooks";
import { eventPassesListensFor } from "./listens-for.ts";
import type {
  TriggerWebhookConfig,
  Webhook,
  WorkflowNode,
} from "@journeyman/core";
import type { Composition } from "../composition.ts";

async function resolveOrgId(c: Composition, workspaceId: string): Promise<string | null> {
  if (!c.pool) return null;
  const r = await c.pool.query<{ org_id: string }>(
    "SELECT org_id FROM jm_workspaces WHERE id = $1",
    [workspaceId],
  );
  return r.rows[0]?.org_id ?? null;
}

export interface TriggerFireInput {
  webhook: Webhook;
  eventId: string;
  eventType: string | null;
  rawPayload: unknown;
}

export interface TriggerOutcome {
  workflowId: string;
  workflowName: string | null;
  triggerNodeId: string;
  ok: boolean;
  workflowInstanceId: string | null;
  error: string | null;
}

export interface TriggerFireResult {
  fired: number;
  failed: number;
  workflowInstanceIds: string[];
  outcomes: TriggerOutcome[];
}

function coerce(
  value: unknown,
  type: "string" | "number" | "boolean" | "json-object" | "json-array",
): unknown {
  if (value == null) return value;
  switch (type) {
    case "string":      return String(value);
    case "number":      return Number(value);
    case "boolean":     return Boolean(value);
    case "json-object": return value;
    case "json-array":  return value;
  }
}

/**
 * For each active trigger-webhook node bound to this webhook, evaluate its
 * filter and (if it matches) start a new workflow instance. Called after
 * matchAndResolveWebhookWaits returns 0 matches — resume-wins precedence.
 */
export async function fireWebhookTriggers(
  c: Composition,
  input: TriggerFireInput,
): Promise<TriggerFireResult> {
  const rows = await c.workflowTriggers.findActiveWebhookTriggers(input.webhook.id);
  if (rows.length === 0) return { fired: 0, failed: 0, workflowInstanceIds: [], outcomes: [] };

  const outcomes: TriggerOutcome[] = [];

  for (const row of rows) {
    // Each trigger is isolated: a throw here records a failed outcome for this
    // workflow and the loop continues, so one bad trigger never discards the
    // successes (or failures) of its siblings.
    let workflowName: string | null = null;
    try {
      const workflow = await c.workflows.getById(row.workflowId);
      if (!workflow || workflow.status !== "ready") continue;
      workflowName = workflow.name;
      if (workflow.publishedVersionId !== row.workflowVersionId) continue;
      const version = await c.workflowVersions.getById(row.workflowVersionId);
      if (!version) continue;

      const node = version.definition.nodes.find((n: WorkflowNode) => n.id === row.triggerNodeId);
      if (!node || node.type !== "trigger-webhook") continue;
      const cfg = (node.config ?? {}) as unknown as TriggerWebhookConfig;

      if (!eventPassesListensFor(cfg.listensFor, input.eventType)) continue;
      if (cfg.acceptIf) {
        const data = (input.rawPayload ?? {}) as Record<string, unknown>;
        const ok = c.conditions.evaluate(cfg.acceptIf as unknown, data);
        if (!ok) continue;
      }

      const inputs: Record<string, unknown> = {};
      for (const [name, mapping] of Object.entries(cfg.inputsMapping ?? {})) {
        const v = readPath(input.rawPayload, mapping.fromPath);
        if (v != null) inputs[name] = coerce(v, mapping.type);
      }

      const { workflowInstanceId } = await c.orchestrator.submit({
        workflowId: workflow.id,
        workflowVersionId: version.id,
        workflowNameSnapshot: workflow.name,
        workspaceId: workflow.workspaceId,
        definitionSnapshot: version.definition,
        inputs,
        startedByUserId: null,
        startedByOrgId: await resolveOrgId(c, workflow.workspaceId),
        triggerSource: "webhook",
        triggerNodeId: node.id,
        webhookEventId: input.eventId,
      });
      outcomes.push({
        workflowId: row.workflowId,
        workflowName,
        triggerNodeId: row.triggerNodeId,
        ok: true,
        workflowInstanceId,
        error: null,
      });
    } catch (err) {
      outcomes.push({
        workflowId: row.workflowId,
        workflowName,
        triggerNodeId: row.triggerNodeId,
        ok: false,
        workflowInstanceId: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const fired = outcomes.filter((o) => o.ok);
  return {
    fired: fired.length,
    failed: outcomes.length - fired.length,
    workflowInstanceIds: fired.map((o) => o.workflowInstanceId as string),
    outcomes,
  };
}
