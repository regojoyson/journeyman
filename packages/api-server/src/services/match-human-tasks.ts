import type { Composition } from "../composition.ts";
import type { HumanTaskConfig, HumanTaskOutputField } from "@journeyman/core";
import { getByPath } from "./jsonpath.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";
import { reconcileRun } from "./engine-reconciler.ts";

export interface WebhookEventInfo {
  id: string;
  provider: string;
  eventType: string | null;
  issueRef: string | null;
  rawPayload: unknown;
}

export interface MatchResult { matched: number; }

export async function matchAndResolveHumanTasks(c: Composition, ev: WebhookEventInfo): Promise<MatchResult> {
  if (!ev.issueRef) return { matched: 0 };

  // Reconcile any active run on this issueRef so the DB reflects current
  // Conductor state — Conductor may have entered a HUMAN task while our DB
  // still showed status='running'.
  const candidates = await c.runs.findActiveRunsByIssueRef(ev.issueRef);
  for (const run of candidates) {
    await reconcileRun(c, run.id);
  }

  // Re-read after reconciliation.
  const paused = await c.runs.findPausedRunsByIssueRef(ev.issueRef);
  let matched = 0;

  for (const run of paused) {
    const exec = await c.nodeExecutions.latestWaitingForRun(run.id);
    if (!exec) continue;

    const node = run.definitionSnapshot.nodes.find(n => n.id === exec.nodeId);
    if (!node || node.type !== "human-task") continue;

    const cfg = (node.config ?? {}) as unknown as HumanTaskConfig;

    // Filter 1: event type whitelist.
    if (cfg.listensFor && ev.eventType && !cfg.listensFor.includes(ev.eventType)) continue;

    // Filter 2: acceptIf JSONLogic against the raw payload.
    if (cfg.acceptIf) {
      const data = (ev.rawPayload ?? {}) as Record<string, unknown>;
      const ok = c.conditions.evaluate(cfg.acceptIf as unknown, data);
      if (!ok) continue;
    }

    // Extract declared outputs from the payload via fromPath.
    const outputs: HumanTaskOutputField[] = Array.isArray(cfg.outputs) ? cfg.outputs : [];
    const values: Record<string, unknown> = {};
    for (const o of outputs) {
      if (!o.fromPath) continue;
      const v = getByPath(ev.rawPayload, o.fromPath);
      if (v != null) values[o.name] = coerce(v, o.type);
    }

    const actor = pickActor(ev.rawPayload);

    await resolveHumanTask(c, {
      runId: run.id,
      nodeId: node.id,
      values,
      payload: (ev.rawPayload ?? {}) as Record<string, unknown>,
      actor,
      source: "webhook",
      webhookEventId: ev.id,
    });
    matched += 1;
  }

  return { matched };
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

function coerce(value: unknown, type: HumanTaskOutputField["type"]): unknown {
  switch (type) {
    case "string":  return typeof value === "string" ? value : String(value);
    case "number":  return typeof value === "number" ? value : Number(value);
    case "boolean": return typeof value === "boolean" ? value : value === "true" || value === 1;
    case "date":    return typeof value === "string" ? value : String(value);
    case "json":    return value;
  }
}
