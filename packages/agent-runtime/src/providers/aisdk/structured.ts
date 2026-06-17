import { Output, jsonSchema, wrapLanguageModel, extractJsonMiddleware } from "ai";
import type { LanguageModel } from "ai";

/** Build the AI SDK structured-output spec from a raw JSON Schema, or undefined. */
export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}

/**
 * Scan `s` for the first balanced JSON object/array that `JSON.parse` accepts.
 * Respects string literals and escapes so braces inside strings don't confuse
 * the depth counter. Returns the matching substring, or undefined.
 */
function findBalancedJson(s: string): string | undefined {
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(i, j + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break; // not valid from this start; try the next opener
          }
        }
      }
    }
  }
  return undefined;
}

/** Return the contents of the last fenced code block (```json … ``` or ``` … ```), or undefined. */
function lastFencedBlock(s: string): string | undefined {
  const re = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: string | undefined;
  while ((match = re.exec(s)) !== null) last = match[1];
  return last?.trim();
}

/** Strip <think>…</think> reasoning blocks, including a dangling unclosed <think>. */
function stripReasoning(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");
}

/**
 * Extract a parseable JSON payload from a model's raw text.
 *
 * Reasoning models served over OpenAI-compatible endpoints (MiniMax-M3, many
 * vLLM/llama.cpp gateways) ignore `response_format` and emit `<think>…</think>`
 * reasoning plus ```json fences directly in the content channel. The AI SDK's
 * `Output.object` parser runs `JSON.parse` over that raw text and throws
 * `NoObjectGeneratedError` on the leading `<`. We recover the JSON before it
 * reaches the parser, trying the most reliable signals first:
 *   1. a fenced block in the reasoning-stripped text,
 *   2. a balanced JSON object/array in the reasoning-stripped text,
 *   3. the same two against the original text (covers JSON emitted *inside* the
 *      think block, as seen in the d8f70c61 run's first attempt).
 * If nothing parses, the original text is returned so the parser raises its own
 * (meaningful) error rather than us masking it.
 */
export function extractJsonPayload(text: string): string {
  if (!text) return text;
  const stripped = stripReasoning(text);
  const candidates = [
    lastFencedBlock(stripped),
    findBalancedJson(stripped),
    lastFencedBlock(text),
    findBalancedJson(text),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      JSON.parse(c);
      return c;
    } catch {
      /* try next candidate */
    }
  }
  return text;
}

/**
 * Wrap a model so that, for structured-output steps, its text is cleaned of
 * reasoning blocks and markdown fences before `Output.object` parses it. This
 * is a no-op for already-clean JSON, so it is safe to apply to every structured
 * call regardless of model.
 */
export function wrapForStructuredOutput(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    // resolveModel hands back a concrete provider model; the union allows a
    // string id, which wrapLanguageModel doesn't accept. Narrow to its param.
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: extractJsonMiddleware({ transform: extractJsonPayload }),
  });
}
