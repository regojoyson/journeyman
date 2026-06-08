import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import { openCodeToolsEnableMap } from "../tool-mapping.ts";
import { resolveOpenCodeModel } from "../model.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";

const log = createLogger("opencode:custom-prompt");

/** Concatenate the text of all text parts in a prompt response. */
function extractText(data: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (data.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Merge MCP system prompts (if any) into one OpenCode `system` string. */
function buildSystem(opts: RunCustomPromptOptions): string | undefined {
  const parts: string[] = [];
  for (const m of opts.mcps ?? []) if (m.systemPrompt) parts.push(m.systemPrompt);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Run a custom prompt through OpenCode. `client` is an already-started server
 * client (index.ts owns start/close). Honors outputMode none|text|structured,
 * tools, cwd (as `directory`), and MCP system prompts.
 */
export async function runCustomPrompt(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: RunCustomPromptOptions,
): Promise<RunCustomPromptResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();

  const model = resolveOpenCodeModel(opts.model, config.model);
  if (!model) return { sessionId, error: "opencode: no model configured (set opts.model as 'providerID/modelID')" };

  if (opts.outputMode === "structured" && !opts.outputSchema) {
    return { sessionId, error: "outputMode='structured' requires outputSchema" };
  }

  log.info(
    { sessionId, outputMode: opts.outputMode, mcpCount: opts.mcps?.length ?? 0, skillCount: opts.skills?.length ?? 0 },
    "runCustomPrompt start",
  );

  const tools = openCodeToolsEnableMap(opts.tools ?? []);
  const system = buildSystem(opts);

  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) return { sessionId, error: "opencode session.create returned no data" };

  const res = await client.session.prompt({
    sessionID: session.data.id,
    parts: [{ type: "text", text: opts.prompt }],
    model,
    ...(Object.keys(tools).length ? { tools } : {}),
    ...(opts.cwd ? { directory: opts.cwd } : {}),
    ...(system ? { system } : {}),
    ...(opts.outputMode === "structured" && opts.outputSchema
      ? { format: { type: "json_schema", schema: opts.outputSchema } }
      : {}),
  });
  if (!res.data) return { sessionId, error: "opencode session.prompt returned no data" };

  const info = res.data.info as { error?: unknown; structured?: unknown };
  logSessionEvent(log, sessionId, info as never);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }

  if (opts.outputMode === "none") return { sessionId };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never) };
  return { sessionId, structured: info.structured };
}
