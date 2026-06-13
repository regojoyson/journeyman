import { generateText, tool, stepCountIs } from "ai";
import type { BuildPlan } from "@journeyman/core";
import type { AssemblerIntent } from "../assembler/intent.ts";
import { assemble } from "../assembler/assemble.ts";
import { assemblerIntentSchema } from "./intent-schema.ts";

export interface ChatMessage { role: "user" | "assistant"; content: string; }

export interface BuilderModelCaller {
  call(req: { system: string; messages: ChatMessage[] }): Promise<{ text: string; proposedIntent: AssemblerIntent | null }>;
}

export interface BuilderTurnResult {
  assistantMessage: string;
  plan: BuildPlan | null;
}

/** Assemble a full BuildPlan from a proposed intent. */
export function planFromIntent(intent: AssemblerIntent): BuildPlan {
  const { workflow, stepBindings, gaps } = assemble(intent);
  return {
    newCustomSteps: intent.newCustomSteps ?? [],
    workflow,
    defaults: { sandboxId: intent.defaults?.sandboxId ?? null, model: intent.defaults?.model ?? null },
    stepBindings,
    gaps,
    summary: intent.summary,
  };
}

/** Run one conversational turn: model → (question | proposed plan). */
export async function runBuilderTurn(
  deps: { caller: BuilderModelCaller },
  input: { system: string; messages: ChatMessage[] },
): Promise<BuilderTurnResult> {
  const { text, proposedIntent } = await deps.caller.call(input);
  return { assistantMessage: text, plan: proposedIntent ? planFromIntent(proposedIntent) : null };
}

/** The real caller: generateText with a proposePlan tool that captures the intent. */
export function makeAiSdkCaller(model: unknown): BuilderModelCaller {
  return {
    async call({ system, messages }) {
      let captured: AssemblerIntent | null = null;
      const proposePlan = tool({
        description: "Propose the complete workflow plan. Call this ONLY when you have enough information to build a correct plan.",
        inputSchema: assemblerIntentSchema,
        execute: async (intent: unknown) => {
          captured = intent as AssemblerIntent;
          return "Plan received.";
        },
      });
      const result = await generateText({
        model: model as never,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: { proposePlan },
        stopWhen: stepCountIs(6),
      } as never);
      return { text: (result as { text?: string }).text ?? "", proposedIntent: captured };
    },
  };
}
