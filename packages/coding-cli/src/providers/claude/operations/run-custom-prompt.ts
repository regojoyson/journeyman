import { query } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLogger } from "@journeyman/core";
import { toMcpServerConfigs, mergeSystemPrompts } from "@journeyman/mcp/sdk-adapter";
import { toSdkPluginConfigs, buildSkillSystemPrompt } from "@journeyman/skills/sdk-adapter";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import { claudeNativeTools } from "../tool-mapping.ts";
import type {
  RunCustomPromptOptions,
  RunCustomPromptResult,
} from "@journeyman/core";

const log = createLogger("claude:custom-prompt");

export type { RunCustomPromptOptions, RunCustomPromptResult };

/**
 * Resolve the SDK's bundled `cli.js` — the actual Claude engine the SDK spawns as
 * a child process. The `./cli.js` subpath isn't exported, so we resolve the package
 * entry (sdk.mjs) and take its sibling, matching the SDK's own internal resolution.
 * Returns undefined if the package can't be resolved (let the SDK try on its own).
 */
function resolveClaudeCli(): string | undefined {
  try {
    const sdkMain = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
    return join(dirname(sdkMain), "cli.js");
  } catch {
    return undefined;
  }
}

export async function runCustomPrompt(
  opts: RunCustomPromptOptions,
): Promise<RunCustomPromptResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  log.info(
    {
      sessionId,
      outputMode: opts.outputMode,
      hasCwd: Boolean(opts.cwd),
      mcpCount: opts.mcps?.length ?? 0,
      skillCount: opts.skills?.length ?? 0,
    },
    "runCustomPrompt start",
  );

  // The SDK shells out to its bundled cli.js (the real engine). In a stale or
  // incomplete runner image it can be absent; fail with an actionable message
  // instead of the SDK's opaque "executable not found" error.
  const cliPath = resolveClaudeCli();
  if (cliPath && !existsSync(cliPath)) {
    const error =
      `Claude engine (cli.js) missing at ${cliPath}. The runner image is likely ` +
      `stale — rebuild the runner bundle and remove cached jm-built images, then retry.`;
    log.error({ sessionId, cliPath }, "cli.js missing");
    return { sessionId, error };
  }

  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;

  const mcpServers = opts.mcps?.length ? toMcpServerConfigs(opts.mcps) : undefined;
  const mcpPromptSuffix = opts.mcps?.length ? mergeSystemPrompts(opts.mcps) : "";
  const mcpKeys = mcpServers ? Object.keys(mcpServers) : [];
  const mcpToolNames = mcpKeys.map((k) => `mcp__${k}`);
  const plugins = opts.skills?.length ? toSdkPluginConfigs(opts.skills) : undefined;
  const skillPromptSuffix = opts.skills?.length ? buildSkillSystemPrompt(opts.skills) : "";
  const skillToolNames = plugins?.length ? ["Skill"] : [];

  const canonicalTools = opts.tools ?? [];
  const baseTools = claudeNativeTools(canonicalTools);
  const tools = [...baseTools, ...mcpToolNames, ...skillToolNames];

  const fullPrompt = [opts.prompt, mcpPromptSuffix, skillPromptSuffix].filter(Boolean).join("\n\n");

  const queryOptions: Record<string, unknown> = {
    ...(tools.length ? { tools, allowedTools: tools } : {}),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    settings: { allowedMcpServers: mcpKeys.map((k) => ({ serverName: k })) },
    ...(mcpServers ? { mcpServers } : {}),
    ...(plugins?.length ? { plugins } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.env && Object.keys(opts.env).length ? { env: opts.env } : {}),
    ...(controller !== undefined ? { abortController: controller } : {}),
    ...queryOption,
  };

  if (opts.outputMode === "structured") {
    if (!opts.outputSchema) {
      return { sessionId, error: "outputMode='structured' requires outputSchema" };
    }
    queryOptions.outputFormat = { type: "json_schema", schema: opts.outputSchema };
  }

  let out: RunCustomPromptResult = { sessionId };

  for await (const msg of query({ prompt: fullPrompt, options: queryOptions as any })) {
    logSdkMessage(msg, opts.onLog, opts.agentLogLevel);
    if ((msg as any).type === "result") {
      const m = msg as any;
      if (m.subtype !== "success") {
        const error = m.errors?.[0] ?? m.subtype ?? "unknown failure";
        log.error({ sessionId, error }, "runCustomPrompt failed");
        return { sessionId, error };
      }
      if (opts.outputMode === "none") {
        out = { sessionId };
      } else if (opts.outputMode === "text") {
        const text = typeof m.result === "string" ? m.result : (m.text ?? "");
        out = { sessionId, result: text };
      } else {
        out = { sessionId, structured: m.structured_output };
      }
    }
  }

  log.info({ sessionId, outputMode: opts.outputMode }, "runCustomPrompt done");
  return out;
}
