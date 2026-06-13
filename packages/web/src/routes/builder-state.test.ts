import { describe, it, expect } from "vitest";
import { reduceChatEvent, canApply, canApplyNow, type BuilderChatState } from "./builder-state.ts";
import type { SseEvent } from "../api/sse-parse.ts";
import type { FlowValidationReport } from "../api/flows.ts";

const empty: BuilderChatState = { messages: [], plan: null, error: null, streaming: true };

describe("reduceChatEvent", () => {
  it("appends an assistant message", () => {
    const ev: SseEvent = { event: "assistant", data: JSON.stringify({ message: "Which repo?" }) };
    const next = reduceChatEvent(empty, ev);
    expect(next.messages.at(-1)).toEqual({ role: "assistant", content: "Which repo?" });
  });
  it("sets the plan on a plan event", () => {
    const plan = { summary: "s", gaps: [], newCustomSteps: [], stepBindings: [], workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } };
    const next = reduceChatEvent(empty, { event: "plan", data: JSON.stringify(plan) });
    expect(next.plan?.summary).toBe("s");
  });
  it("stops streaming on done", () => {
    expect(reduceChatEvent(empty, { event: "done", data: "{}" }).streaming).toBe(false);
  });
  it("captures an error", () => {
    const next = reduceChatEvent(empty, { event: "error", data: JSON.stringify({ message: "boom" }) });
    expect(next.error).toBe("boom");
    expect(next.streaming).toBe(false);
  });
});

describe("canApply", () => {
  const base = { summary: "s", newCustomSteps: [], stepBindings: [], workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } };
  it("is false with no plan", () => { expect(canApply(null)).toBe(false); });
  it("is false when a required gap remains", () => {
    expect(canApply({ ...base, gaps: [{ id: "g", kind: "webhook", nodeIds: [], reason: "", required: true, fixHint: null }] } as never)).toBe(false);
  });
  it("is true with a plan and no required gaps", () => {
    expect(canApply({ ...base, gaps: [] } as never)).toBe(true);
  });
});

describe("canApplyNow", () => {
  const okPlan = { summary: "s", newCustomSteps: [], stepBindings: [], gaps: [],
    workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } } as never;
  const okReport: FlowValidationReport = { ok: true, errors: [], missing: [], warnings: [], secretWarnings: [] };
  const badReport: FlowValidationReport = { ok: false, errors: ["bad"], missing: [], warnings: [], secretWarnings: [] };

  it("allows apply when no validation has run yet (plan + no required gaps)", () => {
    expect(canApplyNow(okPlan, null)).toBe(true);
  });
  it("allows apply when validation passed", () => {
    expect(canApplyNow(okPlan, okReport)).toBe(true);
  });
  it("blocks apply when the latest validation failed", () => {
    expect(canApplyNow(okPlan, badReport)).toBe(false);
  });
  it("blocks apply with no plan", () => {
    expect(canApplyNow(null, okReport)).toBe(false);
  });
});
