import type { Composition } from "../composition.ts";
import type { AgentSkipReason } from "@journeyman/core";
import { readPath } from "@journeyman/webhooks";
import { findAgentByWebhookId, runAgentGuarded, wasSkipped } from "@journeyman/agents";

export interface FireAgentInput {
  webhookId: string;
  rawPayload: unknown;
  /** Event type extracted from the inbound payload (e.g. "push", "pull_request"). */
  eventType?: string | null;
}

export interface FireAgentResult {
  fired: number;
  /** "filtered" → event filtered out; a safety reason → a rail tripped. Both = ignored. */
  skipped?: "filtered" | AgentSkipReason;
  workflowInstanceId?: string;
}

/**
 * If an enabled agent's webhook trigger references this webhook, evaluate its
 * filter, map the payload to the agent's inputs, and fire a run. Returns
 * { fired: 0 } when no agent uses the webhook (so the caller falls through to
 * workflow triggers — existing behaviour is untouched).
 */
export async function fireAgentForWebhook(c: Composition, input: FireAgentInput): Promise<FireAgentResult> {
  if (!c.pool) return { fired: 0 };
  const agent = await findAgentByWebhookId(c.pool, input.webhookId);
  if (!agent) return { fired: 0 };
  const trigger = agent.triggers.find((t) => t.type === "webhook" && t.webhookId === input.webhookId) as
    | Extract<(typeof agent.triggers)[number], { type: "webhook" }>
    | undefined;
  if (!trigger) return { fired: 0 };

  // listensFor filter: if the trigger specifies event types, the inbound event must be in the list.
  if (trigger.listensFor && trigger.listensFor.length > 0 && input.eventType) {
    if (!trigger.listensFor.includes(input.eventType)) {
      return { fired: 0, skipped: "filtered" };
    }
  }

  if (
    trigger.filters &&
    c.conditions.evaluate(trigger.filters, (input.rawPayload ?? {}) as Record<string, unknown>) !== true
  ) {
    return { fired: 0, skipped: "filtered" };
  }

  const inputs: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(trigger.inputsMapping ?? {})) {
    inputs[name] = readPath(input.rawPayload, path);
  }

  const res = await runAgentGuarded(
    { orchestrator: c.orchestrator, pool: c.pool },
    agent,
    inputs,
    "webhook",
    { userId: null, orgId: agent.orgId },
    "trigger-1",
    { payload: input.rawPayload },
  );
  if (wasSkipped(res)) return { fired: 0, skipped: res.skipped };
  return { fired: 1, workflowInstanceId: res.workflowInstanceId };
}
