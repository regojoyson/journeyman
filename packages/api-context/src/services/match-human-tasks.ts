import type { Composition } from "../composition.ts";
import type { WebhookWaitConfig, WebhookWaitOutputField } from "@journeyman/core";
import { getByPath } from "./jsonpath.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";
import { reconcileWorkflowInstance } from "./engine-reconciler.ts";
import { isTerminalStatus } from "@journeyman/core";

export interface WebhookEventInfo {
  id: string;
  provider: string;
  eventType: string | null;
  rawPayload: unknown;
}

export interface WaitOutcome {
  workflowInstanceId: string;
  nodeId: string;
  ok: boolean;
  error: string | null;
}

export interface MatchResult {
  matched: number;
  failed: number;
  outcomes: WaitOutcome[];
}

/**
 * Find paused webhook-wait nodes whose declared correlation key matches this
 * incoming event, then run them through acceptIf and resolve the survivors.
 *
 * Routing model: each paused wait stored `correlation_event_path` and
 * `correlation_value` at pause time (snapshotted from Conductor-resolved
 * inputs). We pull every such candidate, extract `event.payload[eventPath]`,
 * and compare against `correlationValue` for equality.
 */
export async function matchAndResolveWebhookWaits(c: Composition, ev: WebhookEventInfo): Promise<MatchResult> {
  const candidates = await c.nodeExecutions.findAllWaitingWithCorrelation();
  if (candidates.length === 0) return { matched: 0, failed: 0, outcomes: [] };

  const outcomes: WaitOutcome[] = [];

  for (const exec of candidates) {
    if (!exec.correlationEventPath || !exec.correlationValue) continue;

    const eventValue = getByPath(ev.rawPayload, exec.correlationEventPath);
    if (eventValue == null || String(eventValue) !== exec.correlationValue) continue;

    // Each correlated wait is isolated: a throw while resolving one paused
    // instance records a failed outcome and the loop continues, so one bad
    // resume never discards its siblings' results.
    try {
      // Reconcile in case Conductor advanced state since we last looked.
      await reconcileWorkflowInstance(c, exec.workflowInstanceId);
      const instance = await c.workflowInstances.getById(exec.workflowInstanceId);
      if (!instance || isTerminalStatus(instance.status)) continue;

      const node = instance.definitionSnapshot.nodes.find(n => n.id === exec.nodeId);
      if (!node || node.type !== "webhook-wait") continue;

      const cfg = (node.config ?? {}) as unknown as WebhookWaitConfig;

      // Filter 1: event type whitelist.
      if (cfg.listensFor && cfg.listensFor.length > 0 && ev.eventType) {
        if (!cfg.listensFor.includes(ev.eventType)) continue;
      }

      // Filter 2: acceptIf JSONLogic against the raw payload.
      if (cfg.acceptIf) {
        const data = (ev.rawPayload ?? {}) as Record<string, unknown>;
        const ok = c.conditions.evaluate(cfg.acceptIf as unknown, data);
        if (!ok) continue;
      }

      // Extract declared outputs from the payload via fromPath.
      const outputs: WebhookWaitOutputField[] = Array.isArray(cfg.outputs) ? cfg.outputs : [];
      const values: Record<string, unknown> = {};
      for (const o of outputs) {
        if (!o.fromPath) continue;
        const v = getByPath(ev.rawPayload, o.fromPath);
        if (v != null) values[o.name] = coerce(v, o.type);
      }

      const actor = pickActor(ev.rawPayload);

      await resolveHumanTask(c, {
        workflowInstanceId: instance.id,
        nodeId: node.id,
        values,
        payload: (ev.rawPayload ?? {}) as Record<string, unknown>,
        actor,
        source: "webhook",
        webhookEventId: ev.id,
      });
      outcomes.push({ workflowInstanceId: exec.workflowInstanceId, nodeId: exec.nodeId, ok: true, error: null });
    } catch (err) {
      outcomes.push({
        workflowInstanceId: exec.workflowInstanceId,
        nodeId: exec.nodeId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const matched = outcomes.filter((o) => o.ok).length;
  return { matched, failed: outcomes.length - matched, outcomes };
}

function pickActor(payload: unknown): string | null {
  // Best-effort actor extraction across providers.
  const candidates = [
    "user.accountId",      // jira
    "sender.login",        // github
    "user.username",       // gitlab
    "userId",              // monday
  ];
  for (const path of candidates) {
    const v = getByPath(payload, path);
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function coerce(value: unknown, type: WebhookWaitOutputField["type"]): unknown {
  switch (type) {
    case "string":  return typeof value === "string" ? value : String(value);
    case "number":  return typeof value === "number" ? value : Number(value);
    case "boolean": return typeof value === "boolean" ? value : value === "true" || value === 1;
    case "date":    return typeof value === "string" ? value : String(value);
    case "json":    return value;
  }
}
