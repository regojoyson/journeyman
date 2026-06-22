import { createServer } from "node:net";
import { join } from "node:path";
import type { CodingModelConfig, ResolvedMcpInstance, ResolvedSkillPackage } from "@journeyman/core";
import { codingModelKeySlot } from "@journeyman/core";
import type { OpenCodeProviderConfig } from "./types.ts";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";
import { parseOpenCodeModel } from "./model.ts";

// `external_directory: "deny"` confines the agent to its working directory
// (/workspace). It governs EVERY path-taking tool — read/edit/glob/grep and bash
// working dirs — so a single setting hard-blocks out-of-workspace access (the
// Claude-hook equivalent, reads included). "deny" is synchronous: OpenCode refuses
// instantly and returns an error the model can recover from. It also removes the
// default "ask" behaviour, which — with no permission client subscribed — leaves
// the agent blocked forever on an unanswered prompt.
const BYPASS_PERMISSION = {
  bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow",
  external_directory: "deny",
  // `question` is the interactive ask-the-user tool. We run autonomously with no
  // human to answer, so deny it server-wide: a denied call returns an error the
  // model can recover from, instead of blocking the step forever waiting for input.
  question: "deny",
} as const;

/** Default agent step budget when the step doesn't specify maxSteps — matches the Claude/AISDK providers. */
const DEFAULT_STEP_BUDGET = 80;

/**
 * The OpenCode agent every prompt runs under. It MUST match the agent key we set
 * `maxSteps` on below — prompts pass `agent: OPENCODE_AGENT` explicitly so the
 * step budget can never silently fail to apply (which it would if a prompt ran
 * under a different default agent than the one configured). "build" is OpenCode's
 * full-capability primary agent.
 */
export const OPENCODE_AGENT = "build";

export interface ServerConfigRuntime {
  mcps?: ResolvedMcpInstance[];
  model?: string;
  modelConfig?: CodingModelConfig;
  env?: Record<string, string>;
  maxSteps?: number;
  skills?: ResolvedSkillPackage[];
}

/**
 * Assemble the OpenCode `Config` passed at managed-server spawn: bypass-style
 * permissions, merged MCP, and — when the chosen model carries custom endpoint
 * config — a `provider` block keyed by the model string's providerID. No
 * modelConfig ⇒ no provider block ⇒ OpenCode uses its built-in catalog.
 * Tools/model/format are NOT here — those are per-prompt params.
 */
export function buildServerConfig(
  config: OpenCodeProviderConfig,
  runtime: ServerConfigRuntime,
): Record<string, unknown> {
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(runtime.mcps?.length ? toOpenCodeMcpConfigs(runtime.mcps) : {}) };
  const provider = buildProviderBlock(runtime.model, runtime.modelConfig, runtime.env);
  const maxSteps = runtime.maxSteps && runtime.maxSteps > 0 ? runtime.maxSteps : DEFAULT_STEP_BUDGET;
  const skillPaths = (runtime.skills ?? []).flatMap((pkg) => pkg.enabledSkills.map((name) => join(pkg.localPath, name)));
  return {
    permission,
    agent: { [OPENCODE_AGENT]: { maxSteps } },
    ...(Object.keys(mcp).length ? { mcp } : {}),
    ...(provider ? { provider } : {}),
    ...(skillPaths.length ? { skills: { paths: skillPaths } } : {}),
  };
}

/** Build OpenCode's `provider` entry for a custom endpoint, or undefined if none. */
function buildProviderBlock(
  model: string | undefined,
  modelConfig: CodingModelConfig | undefined,
  env: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  if (!modelConfig?.baseUrl) return undefined; // a custom endpoint is defined by its URL
  const parsed = model ? parseOpenCodeModel(model) : undefined;
  if (!parsed) return undefined;

  const npm = modelConfig.npm ?? "@ai-sdk/openai-compatible";
  const slot = codingModelKeySlot({ provider: "opencode", config: modelConfig, modelId: model });
  const apiKey = modelConfig.requiresApiKey ? env?.[slot] : undefined;
  // OpenCode streams; OpenAI-compatible servers only return usage on a stream when
  // stream_options.include_usage is set. Default it on for that npm so local models
  // report tokens; an explicit value always wins. Other providers handle usage
  // themselves, so only forward the flag for them when explicitly set.
  const includeUsage = modelConfig.includeUsage ?? (npm === "@ai-sdk/openai-compatible" ? true : undefined);
  const options: Record<string, unknown> = {
    ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(includeUsage !== undefined ? { includeUsage } : {}),
  };
  return {
    [parsed.providerID]: {
      npm,
      options,
      // A custom provider must declare its models or OpenCode can't resolve the
      // model and throws a generic "UnknownError". Declare the one we target.
      // `reasoning: true` (from the model's supportsThinking flag) makes OpenCode
      // enable and parse the model's thinking channel; without it a reasoning
      // model's narration is mishandled and dropped.
      models: { [parsed.modelID]: modelConfig.reasoning ? { reasoning: true } : {} },
    },
  };
}

/**
 * Temporarily set env vars on process.env (the only channel the SDK forwards to
 * the spawned `opencode` process) and return a restore fn. Needed for the LOCAL
 * backend, where per-call secrets are not already on process.env. In the Docker
 * backend the runner's process.env already carries them, so this is a harmless
 * re-set. NOTE: process.env is process-global — concurrent local-backend ops can
 * race; acceptable for dev (Docker is the isolated production path).
 */
export function applyEnv(env: Record<string, string> | undefined): () => void {
  if (!env || !Object.keys(env).length) return () => {};
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, old] of Object.entries(prev)) {
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }
  };
}

/** Grab a free ephemeral TCP port so concurrent local managed servers don't collide. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
