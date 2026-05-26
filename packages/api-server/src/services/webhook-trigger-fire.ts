import { readPath } from "@journeyman/webhooks";
import type {
  TriggerWebhookConfig,
  Webhook,
  WorkflowNode,
} from "@journeyman/core";
import type { Composition } from "../composition.ts";

export interface TriggerFireInput {
  webhook: Webhook;
  eventId: string;
  eventType: string | null;
  rawPayload: unknown;
}

export interface TriggerFireResult {
  fired: number;
  workflowInstanceIds: string[];
}

function coerce(value: unknown, type: "string" | "number" | "boolean" | "json"): unknown {
  if (value == null) return value;
  switch (type) {
    case "string": return String(value);
    case "number": return Number(value);
    case "boolean": return Boolean(value);
    case "json":   return value;
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
  if (rows.length === 0) return { fired: 0, workflowInstanceIds: [] };

  const fired: string[] = [];

  for (const row of rows) {
    const workflow = await c.workflows.getById(row.workflowId);
    if (!workflow || workflow.status !== "ready") continue;
    if (workflow.currentVersionId !== row.workflowVersionId) continue;
    const version = await c.workflowVersions.getById(row.workflowVersionId);
    if (!version) continue;

    const node = version.definition.nodes.find((n: WorkflowNode) => n.id === row.triggerNodeId);
    if (!node || node.type !== "trigger-webhook") continue;
    const cfg = (node.config ?? {}) as unknown as TriggerWebhookConfig;

    if (cfg.listensFor && cfg.listensFor.length > 0 && input.eventType) {
      if (!cfg.listensFor.includes(input.eventType)) continue;
    }
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
      workflowScopeSnapshot: workflow.scope,
      definitionSnapshot: version.definition,
      inputs,
      startedByUserId: null,
      startedByOrgId: workflow.orgId,
      triggerSource: "webhook",
      triggerNodeId: node.id,
      webhookEventId: input.eventId,
    });
    fired.push(workflowInstanceId);
  }

  return { fired: fired.length, workflowInstanceIds: fired };
}
