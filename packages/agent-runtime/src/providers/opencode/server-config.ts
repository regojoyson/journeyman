import { createServer } from "node:net";
import type { CodingModelConfig, ResolvedMcpInstance } from "@journeyman/core";
import type { OpenCodeProviderConfig } from "./types.ts";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";
import { parseOpenCodeModel } from "./model.ts";

const BYPASS_PERMISSION = {
  bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow",
} as const;

/** Default agent step budget when the step doesn't specify maxSteps — matches the Claude/AISDK providers. */
const DEFAULT_STEP_BUDGET = 80;

export interface ServerConfigRuntime {
  mcps?: ResolvedMcpInstance[];
  model?: string;
  modelConfig?: CodingModelConfig;
  env?: Record<string, string>;
  maxSteps?: number;
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
  return {
    permission,
    agent: { build: { maxSteps } },
    ...(Object.keys(mcp).length ? { mcp } : {}),
    ...(provider ? { provider } : {}),
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

  const apiKey = modelConfig.apiKeySlot ? env?.[modelConfig.apiKeySlot] : undefined;
  const options: Record<string, unknown> = {
    ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
  return {
    [parsed.providerID]: {
      npm: modelConfig.npm ?? "@ai-sdk/openai-compatible",
      options,
      // A custom provider must declare its models or OpenCode can't resolve the
      // model and throws a generic "UnknownError". Declare the one we target.
      models: { [parsed.modelID]: {} },
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
