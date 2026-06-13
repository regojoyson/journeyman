import type { BuildPlan } from "@journeyman/core";
import type { SseEvent } from "../api/sse-parse.ts";
import type { FlowValidationReport } from "../api/flows.ts";

export interface ChatMsg { role: "user" | "assistant"; content: string; }

export interface BuilderChatState {
  messages: ChatMsg[];
  plan: BuildPlan | null;
  error: string | null;
  streaming: boolean;
}

/** Fold one SSE event into the chat state. Pure. */
export function reduceChatEvent(state: BuilderChatState, ev: SseEvent): BuilderChatState {
  switch (ev.event) {
    case "assistant": {
      const { message } = safeJson(ev.data) as { message?: string };
      return { ...state, messages: [...state.messages, { role: "assistant", content: message ?? "" }] };
    }
    case "plan":
      return { ...state, plan: safeJson(ev.data) as BuildPlan };
    case "error":
      return { ...state, error: (safeJson(ev.data) as { message?: string }).message ?? "error", streaming: false };
    case "done":
      return { ...state, streaming: false };
    default:
      return state;
  }
}

/** Apply is allowed only with a plan and no remaining required gaps. */
export function canApply(plan: BuildPlan | null): boolean {
  if (!plan) return false;
  return !plan.gaps.some((g) => g.required);
}

/**
 * Apply gate used after inline edits: a plan with no required gaps, and — if a
 * validation has run — a passing report. Null report ⇒ not yet validated, allowed.
 */
export function canApplyNow(plan: BuildPlan | null, validation: FlowValidationReport | null): boolean {
  if (!canApply(plan)) return false;
  return validation === null || validation.ok;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
