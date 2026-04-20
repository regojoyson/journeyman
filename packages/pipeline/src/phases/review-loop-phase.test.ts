/**
 * @file review-loop-phase.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { ReviewLoopPhase } from "./review-loop-phase.ts";
import { PhaseRegistry } from "../registry/phase-registry.ts";
import type { IPhase, PhaseResult, PipelineContext } from "@journeyman/core";

function mkCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    sessionId: "s1", productId: "p1", ticketKey: "t1", ticketShortKey: "t1",
    flowName: "f", workspaceDir: "/tmp",
    signal: new AbortController().signal,
    productConfig: {
      flow: "f", workspace: "/tmp", repos: [],
      ticketWorkflow: {
        statuses: {
          "completed": "Completed",
          "rework-requested": "Rework",
        },
      },
    },
    providers: {} as any, artifacts: {}, state: {} as any,
    trace: {} as any, artifactStore: {} as any, emit: () => {},
    currentStepId: "code-review",
    ...overrides,
  };
}

function mkRegistryWith(name: string, phase: IPhase): PhaseRegistry {
  const reg = new PhaseRegistry();
  reg.register(name, () => phase);
  return reg;
}

const cfg = {
  approveStatus: "completed",
  reworkStatus: "rework-requested",
  onRework: ["fetchPRComments"],
  maxCycles: 2,
};

describe("ReviewLoopPhase", () => {
  it("blocks on first entry", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const result = await phase.run(mkCtx(), cfg);
    expect(result.status).toBe("blocked");
  });

  it("returns ok on approve status", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Completed" } });
    const result = await phase.run(ctx, cfg) as Extract<PhaseResult, { status: "ok" }>;
    expect(result.status).toBe("ok");
    expect(result.artifacts["code-review_outcome"]).toBe("approved");
  });

  it("runs sub-phases and re-blocks on rework", async () => {
    const sub: IPhase = {
      name: "fetchPRComments",
      run: vi.fn().mockResolvedValue({ status: "ok", artifacts: { reviewComments: "c1" } }),
    };
    const phase = new ReviewLoopPhase(mkRegistryWith("fetchPRComments", sub));
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework" } });

    const result = await phase.run(ctx, cfg) as Extract<PhaseResult, { status: "blocked" }>;
    expect(result.status).toBe("blocked");
    expect(result.artifacts?.["code-review_cycles"]).toBe(1);
    expect(ctx.artifacts.reviewComments).toBe("c1");
    expect(sub.run).toHaveBeenCalledOnce();
  });

  it("fails when maxCycles exceeded", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework", "code-review_cycles": 2 } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("failed");
  });

  it("propagates sub-phase failure", async () => {
    const sub: IPhase = {
      name: "fetchPRComments",
      run: vi.fn().mockResolvedValue({ status: "failed", error: { message: "boom" } }),
    };
    const phase = new ReviewLoopPhase(mkRegistryWith("fetchPRComments", sub));
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Rework" } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("failed");
  });

  it("re-blocks on unhandled status", async () => {
    const phase = new ReviewLoopPhase(new PhaseRegistry());
    const ctx = mkCtx({ artifacts: { __resumeStatus: "Other" } });
    const result = await phase.run(ctx, cfg);
    expect(result.status).toBe("blocked");
  });
});
