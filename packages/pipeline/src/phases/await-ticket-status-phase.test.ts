/**
 * @file await-ticket-status-phase.test.ts
 */

import { describe, it, expect } from "vitest";
import { AwaitTicketStatusPhase, resolveSemantic } from "./await-ticket-status-phase.ts";
import type { PipelineContext } from "@journeyman/core";

function mkCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    sessionId: "s1",
    productId: "p1",
    ticketKey: "t1",
    ticketShortKey: "t1",
    flowName: "f",
    workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: {
      flow: "f", workspace: "/tmp", repos: [],
      ticketWorkflow: {
        statuses: {
          "plan-approved": "Plan Approved",
          "failed": "Failed",
        },
      },
    },
    providers: {} as any,
    artifacts: {},
    state: {} as any,
    trace: {} as any,
    artifactStore: {} as any,
    emit: () => {},
    currentStepId: "await-plan",
    ...overrides,
  };
}

describe("AwaitTicketStatusPhase", () => {
  it("blocks on first entry (no __resumeStatus)", async () => {
    const phase = new AwaitTicketStatusPhase();
    const result = await phase.run(mkCtx(), { continueOn: ["plan-approved"] });
    expect(result.status).toBe("blocked");
  });

  it("returns ok when resumed with a continueOn status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Plan Approved" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"] });
    expect(result.status).toBe("ok");
  });

  it("fails when resumed with a failOn status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Failed" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"], failOn: ["failed"] });
    expect(result.status).toBe("failed");
  });

  it("re-blocks on unknown status", async () => {
    const phase = new AwaitTicketStatusPhase();
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Random" } });
    const result = await phase.run(ctx, { continueOn: ["plan-approved"] });
    expect(result.status).toBe("blocked");
  });
});

describe("resolveSemantic", () => {
  it("maps literal to semantic name", () => {
    const ctx = mkCtx();
    expect(resolveSemantic(ctx, "Plan Approved")).toBe("plan-approved");
  });

  it("falls back to the literal when no mapping exists", () => {
    const ctx = mkCtx();
    expect(resolveSemantic(ctx, "Nothing")).toBe("Nothing");
  });
});
