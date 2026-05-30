import { describe, it, expect } from "vitest";
import type { Webhook } from "@journeyman/core";
import { fireWebhookTriggers } from "./webhook-trigger-fire.ts";
import type { Composition } from "../composition.ts";

// Reproduces the fan-out bug: a webhook bound to two trigger nodes where one
// workflow submits cleanly and the other throws synchronously during submit.
// The successful submission must NOT be lost — both outcomes are reported.

function triggerRow(id: string, workflowId: string) {
  return {
    id,
    workflowId,
    workflowVersionId: `${workflowId}-v1`,
    triggerNodeId: `${workflowId}-trigger`,
    kind: "webhook" as const,
    webhookId: "wh-1",
    isActive: true,
    createdAt: new Date("2026-05-30T00:00:00Z"),
  };
}

function workflow(workflowId: string) {
  return {
    id: workflowId,
    name: `Workflow ${workflowId}`,
    status: "ready" as const,
    currentVersionId: `${workflowId}-v1`,
    scope: "user" as const,
    ownerUserId: "user-1",
    orgId: "org-1",
  };
}

function version(workflowId: string) {
  return {
    id: `${workflowId}-v1`,
    definition: {
      nodes: [{ id: `${workflowId}-trigger`, type: "trigger-webhook", config: { webhookId: "wh-1", inputsMapping: {} } }],
    },
  };
}

function fakeComposition(submit: (workflowId: string) => Promise<{ workflowInstanceId: string }>): Composition {
  const workflows = new Map([workflow("wf-A"), workflow("wf-B")].map((w) => [w.id, w]));
  const versions = new Map([version("wf-A"), version("wf-B")].map((v) => [v.id, v]));
  return {
    workflowTriggers: {
      findActiveWebhookTriggers: async () => [triggerRow("t-A", "wf-A"), triggerRow("t-B", "wf-B")],
    },
    workflows: { getById: async (id: string) => workflows.get(id) ?? null },
    workflowVersions: { getById: async (id: string) => versions.get(id) ?? null },
    orchestrator: {
      submit: async (args: { workflowId: string }) => submit(args.workflowId),
    },
  } as unknown as Composition;
}

describe("fireWebhookTriggers — per-trigger isolation", () => {
  const webhook = { id: "wh-1" } as Webhook;

  it("records both a successful and a failing trigger when one submit throws", async () => {
    const c = fakeComposition(async (workflowId) => {
      if (workflowId === "wf-B") throw new Error("conductor rejected def");
      return { workflowInstanceId: `inst-${workflowId}` };
    });

    const result = await fireWebhookTriggers(c, {
      webhook,
      eventId: "ev-1",
      eventType: "push",
      rawPayload: {},
    });

    expect(result.fired).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.workflowInstanceIds).toEqual(["inst-wf-A"]);

    const byWorkflow = Object.fromEntries(result.outcomes.map((o) => [o.workflowId, o]));
    expect(byWorkflow["wf-A"]).toMatchObject({ ok: true, workflowInstanceId: "inst-wf-A", error: null });
    expect(byWorkflow["wf-B"]).toMatchObject({ ok: false, workflowInstanceId: null });
    expect(byWorkflow["wf-B"]!.error).toContain("conductor rejected def");
  });
});
