import {
  PROVIDER_CATALOG,
  unsupportedOperationForStep,
  type Gap,
} from "@journeyman/core";
import type { AssemblerIntent } from "./intent.ts";

export interface GapDeps {
  /** intent step ref → assigned node id. */
  nodeIdByRef: Record<string, string>;
  /** assigned ids of trigger nodes, in trigger order. */
  triggerNodeIds?: string[];
}

function providerImplemented(provider: string): boolean {
  const entry = PROVIDER_CATALOG.find((p) => p.value === provider);
  return entry?.implemented === true;
}

let gapSeq = 0;
function gapId(): string {
  gapSeq += 1;
  return `gap_${gapSeq}`;
}

/** Detect availability gaps for an intent (provider stubs, deny-listed ops, missing webhooks). */
export function detectGaps(intent: AssemblerIntent, deps: GapDeps): Gap[] {
  const gaps: Gap[] = [];

  // Provider step availability.
  for (const s of intent.steps) {
    if (s.kind === "provider" && s.stepType && s.provider) {
      const nodeId = deps.nodeIdByRef[s.ref];
      if (!nodeId) continue;
      const denied = unsupportedOperationForStep(s.provider, s.stepType);
      if (denied) {
        gaps.push({
          id: gapId(), kind: "not-implemented", nodeIds: [nodeId],
          reason: denied.reason, required: true, fixHint: null,
        });
      } else if (!providerImplemented(s.provider)) {
        gaps.push({
          id: gapId(), kind: "not-implemented", nodeIds: [nodeId],
          reason: `The ${s.provider} provider is not implemented yet.`,
          required: true, fixHint: null,
        });
      }
    }
    // webhook-wait needing a webhook.
    if (s.kind === "webhook-wait" && (s.waitWebhookId === null || s.waitWebhookId === undefined)) {
      const nodeId = deps.nodeIdByRef[s.ref];
      if (nodeId) {
        gaps.push({
          id: gapId(), kind: "webhook", nodeIds: [nodeId],
          reason: "This wait needs a webhook to resume on; none is configured.",
          required: true, fixHint: "Configure a webhook in settings.",
        });
      }
    }
  }

  // Webhook trigger needing a webhook record.
  intent.triggers.forEach((t, i) => {
    if (t.kind === "webhook" && t.webhookId === null) {
      const nodeId = deps.triggerNodeIds?.[i];
      gaps.push({
        id: gapId(), kind: "webhook", nodeIds: nodeId ? [nodeId] : [],
        reason: "This trigger needs a webhook; none is configured.",
        required: true, fixHint: "Configure a webhook in settings.",
      });
    }
  });

  return gaps;
}
