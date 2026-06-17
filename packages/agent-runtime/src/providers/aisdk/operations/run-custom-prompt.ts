import { generateText, stepCountIs } from "ai";
import { createLogger } from "@journeyman/core";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";
import { resolveModel } from "../model.ts";
import { aiSdkToolIds } from "../tool-mapping.ts";
import { buildBuiltinTools } from "../tools/index.ts";
import { buildMcpTools } from "../mcp.ts";
import { buildSkillMenu, skillTool } from "../skills.ts";
import { buildOutput, wrapForStructuredOutput, extractJsonPayload } from "../structured.ts";
import { makeStepLogger, logFinal } from "../utils/sdk-logger.ts";
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";

const log = createLogger("aisdk:custom-prompt");
const STEP_CAP = 40;

function truncate(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * The model's final assistant text. Prefer `result.text`; when that is empty
 * (the last step was a tool call — see vercel/ai#11348) fall back to the newest
 * non-empty step text. Provider-agnostic: works for Anthropic, OpenAI, and any
 * OpenAI-compatible/Bedrock model.
 */
function finalAssistantText(result: { text?: unknown; steps?: unknown }): string {
  if (typeof result.text === "string" && result.text.trim()) return result.text;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = (steps[i] as { text?: unknown })?.text;
    if (typeof t === "string" && t.trim()) return t;
  }
  return typeof result.text === "string" ? result.text : "";
}

/**
 * Read the structured result. The AI SDK only resolves `result.output` when the
 * final step's finishReason is "stop"; with tool-using steps it is often
 * "tool-calls"/"unknown", so `result.output` throws NoOutputGeneratedError even
 * though the model printed valid JSON (vercel/ai#10235, #11348 — both open). In
 * that case we recover the JSON from the model's text ourselves.
 */
function readStructured(result: { output?: unknown; text?: unknown; steps?: unknown }): unknown {
  try {
    const out = result.output;
    if (out !== undefined) return out;
  } catch {
    /* NoOutputGeneratedError — fall through to text recovery */
  }
  const text = finalAssistantText(result);
  return JSON.parse(extractJsonPayload(text));
}

/**
 * Build a diagnosable error string. AI SDK's APICallError reports a bare
 * `message` like "Bad Request"; the actionable detail (the model server's
 * rejection reason) lives on `statusCode` / `url` / `responseBody` / `data`,
 * which we must surface or failures are undebuggable.
 */
export function describeError(err: unknown): string {
  const e = err as Record<string, unknown> | undefined;
  const parts: string[] = [String((e?.message as string) ?? err)];
  if (e?.statusCode != null) parts.push(`status=${e.statusCode}`);
  if (e?.url) parts.push(`url=${String(e.url)}`);
  if (e?.responseBody) parts.push(`body=${truncate(String(e.responseBody))}`);
  else if (e?.data) {
    try { parts.push(`data=${truncate(JSON.stringify(e.data))}`); } catch { /* non-serializable */ }
  }
  const cause = e?.cause as { message?: string } | undefined;
  if (cause && cause !== e) parts.push(`cause=${String(cause.message ?? cause)}`);
  return parts.join(" | ");
}

export async function runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const level = opts.agentLogLevel ?? "all";

  if (opts.outputMode === "structured" && !opts.outputSchema) {
    return { sessionId, error: "outputMode='structured' requires outputSchema" };
  }

  log.info(
    { sessionId, outputMode: opts.outputMode, mcpCount: opts.mcps?.length ?? 0, skillCount: opts.skills?.length ?? 0 },
    "runCustomPrompt start",
  );

  let mcp: { tools: Record<string, unknown>; close: () => Promise<void> } = { tools: {}, close: async () => {} };
  try {
    const baseModel = await resolveModel({ modelId: opts.model, config: opts.modelConfig, env: opts.env });
    // Reasoning models (e.g. MiniMax-M3) leak <think>…</think> and ```json fences
    // into the content channel, which defeats Output.object's JSON.parse. Wrap the
    // model so structured steps see clean JSON. No-op for already-clean output.
    const model = opts.outputMode === "structured"
      ? wrapForStructuredOutput(baseModel as Parameters<typeof wrapForStructuredOutput>[0])
      : baseModel;
    const ctx = { cwd: opts.cwd, env: opts.env };

    const builtin = buildBuiltinTools(aiSdkToolIds(opts.tools ?? []), ctx);
    if (opts.mcps?.length) mcp = await buildMcpTools(opts.mcps);
    const skills = opts.skills ?? [];
    const skillTools = skills.length ? { Skill: skillTool(skills) } : {};
    const tools = { ...builtin, ...mcp.tools, ...skillTools };
    const hasTools = Object.keys(tools).length > 0;

    const confinement = opts.cwd ? confinementSystemPrompt(opts.cwd) : "";
    const prompt = [confinement, opts.prompt, buildSkillMenu(skills)].filter(Boolean).join("\n\n");

    const result: any = await generateText({
      model,
      prompt,
      ...(hasTools ? { tools } : {}),
      stopWhen: stepCountIs(STEP_CAP),
      // AI SDK 6 stable option is `output` (was `experimental_output`); result is on `result.output`.
      ...(opts.outputMode === "structured" ? { output: buildOutput(opts.outputSchema) } : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
      onStepFinish: makeStepLogger(opts.onLog, level),
    } as any);

    logFinal(true, undefined, opts.onLog, level);
    log.info({ sessionId }, "runCustomPrompt done");

    if (opts.outputMode === "none") return { sessionId };
    if (opts.outputMode === "text") return { sessionId, result: typeof result.text === "string" ? result.text : "" };
    try {
      return { sessionId, structured: readStructured(result) };
    } catch {
      const text = finalAssistantText(result);
      return { sessionId, error: `structured step produced no parseable JSON. Final text: ${truncate(text, 500)}` };
    }
  } catch (err) {
    const error = describeError(err);
    logFinal(false, error, opts.onLog, level);
    log.error({ sessionId, error }, "runCustomPrompt threw");
    return { sessionId, error };
  } finally {
    await mcp.close();
  }
}
