import { Output, jsonSchema, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { LanguageModel } from "ai";

/** Build the AI SDK structured-output spec from a raw JSON Schema, or undefined. */
export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}

/**
 * Wrap a model so structured-output steps survive reasoning models. The SDK's
 * extractReasoningMiddleware peels a reasoning tag's content out of the *content*
 * channel into a separate `reasoning` field, leaving clean JSON for
 * Output.object's parser. Reasoning models served over OpenAI-compatible
 * endpoints (MiniMax-M3, many vLLM/llama.cpp gateways) emit these blocks even
 * when they ignore `response_format`. We chain the common tag variants; each is a
 * no-op when its tag is absent, so this is safe to apply to every structured step.
 *
 * Known limitation: this does NOT recover JSON wrapped in ```json fences or
 * surrounded by prose — it relies on the model emitting clean JSON after its
 * reasoning block.
 */
export function wrapForStructuredOutput(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    // resolveModel hands back a concrete provider model; the union allows a
    // string id, which wrapLanguageModel doesn't accept. Narrow to its param.
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: [
      extractReasoningMiddleware({ tagName: "think" }),
      extractReasoningMiddleware({ tagName: "thinking" }),
      extractReasoningMiddleware({ tagName: "reasoning" }),
    ],
  });
}
