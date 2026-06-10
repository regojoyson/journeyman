import { generateText, stepCountIs } from "ai";
import { createLogger } from "@journeyman/core";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";
import { resolveModel } from "../model.ts";
import { aiSdkToolIds } from "../tool-mapping.ts";
import { buildBuiltinTools } from "../tools/index.ts";
import { buildMcpTools } from "../mcp.ts";
import { buildSkillMenu, skillTool } from "../skills.ts";
import { buildOutput } from "../structured.ts";
import { makeStepLogger, logFinal } from "../utils/sdk-logger.ts";

const log = createLogger("aisdk:custom-prompt");
const STEP_CAP = 40;

function truncate(s: string, max = 2000): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
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
    const model = await resolveModel({ modelId: opts.model, config: opts.modelConfig, env: opts.env });
    const ctx = { cwd: opts.cwd, env: opts.env };

    const builtin = buildBuiltinTools(aiSdkToolIds(opts.tools ?? []), ctx);
    if (opts.mcps?.length) mcp = await buildMcpTools(opts.mcps);
    const skills = opts.skills ?? [];
    const skillTools = skills.length ? { Skill: skillTool(skills) } : {};
    const tools = { ...builtin, ...mcp.tools, ...skillTools };
    const hasTools = Object.keys(tools).length > 0;

    const prompt = [opts.prompt, buildSkillMenu(skills)].filter(Boolean).join("\n\n");

    const result: any = await generateText({
      model,
      prompt,
      ...(hasTools ? { tools } : {}),
      stopWhen: stepCountIs(STEP_CAP),
      // AI SDK 6 accepts `experimental_output`; the result is on `result.experimental_output`.
      ...(opts.outputMode === "structured" ? { experimental_output: buildOutput(opts.outputSchema) } : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
      onStepFinish: makeStepLogger(opts.onLog, level),
    } as any);

    logFinal(true, undefined, opts.onLog, level);
    log.info({ sessionId }, "runCustomPrompt done");

    if (opts.outputMode === "none") return { sessionId };
    if (opts.outputMode === "text") return { sessionId, result: typeof result.text === "string" ? result.text : "" };
    return { sessionId, structured: result.experimental_output ?? result.output };
  } catch (err) {
    const error = describeError(err);
    logFinal(false, error, opts.onLog, level);
    log.error({ sessionId, error }, "runCustomPrompt threw");
    return { sessionId, error };
  } finally {
    await mcp.close();
  }
}
