import type { CodingModelConfig } from "@journeyman/core";
import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage, codingModelKeySlot } from "@journeyman/core";

export interface ResolveModelOpts {
  modelId: string | undefined;
  config: CodingModelConfig | undefined;
  env?: Record<string, string>;
}

export interface ResolveModelDeps {
  /** Injectable for tests; defaults to dynamic import. */
  importer?: (npm: string) => Promise<any>;
}

type ProviderFactory = (mod: any, o: { apiKey?: string; baseURL?: string }) => (modelId: string) => unknown;

const LOADERS: Record<string, ProviderFactory> = {
  "@ai-sdk/anthropic":         (m, o) => m.createAnthropic({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai":            (m, o) => m.createOpenAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/google":            (m, o) => m.createGoogleGenerativeAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  // supportsStructuredOutputs: true makes structured steps send
  // `response_format: { type: "json_schema" }` (schema-enforced) instead of the
  // default `{ type: "json_object" }`. Modern OpenAI-compatible servers
  // (LM Studio, vLLM, llama.cpp, OpenRouter) require json_schema and reject
  // json_object ("'response_format.type' must be 'json_schema' or 'text'").
  "@ai-sdk/openai-compatible": (m, o) => m.createOpenAICompatible({ name: "custom", baseURL: o.baseURL, apiKey: o.apiKey, supportsStructuredOutputs: true }),
};

export function configError(message: string): Error {
  const e = new Error(message) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}

export async function resolveModel(opts: ResolveModelOpts, deps: ResolveModelDeps = {}): Promise<unknown> {
  if (!opts.modelId) throw configError("aisdk provider requires a model");
  const npm = opts.config?.npm ?? "@ai-sdk/openai-compatible";
  if (!isAiSdkPackage(npm) || !LOADERS[npm]) {
    throw configError(`Unsupported aisdk provider package: ${npm}. Allowed: ${AISDK_PROVIDER_PACKAGES.map((p) => p.npm).join(", ")}`);
  }
  if (npm === "@ai-sdk/openai-compatible" && !opts.config?.baseUrl?.trim()) {
    throw configError("@ai-sdk/openai-compatible requires config.baseUrl");
  }
  const slot = codingModelKeySlot({ provider: "aisdk", config: opts.config, modelId: opts.modelId });
  const apiKey = opts.env?.[slot] ?? process.env[slot];
  const importer = deps.importer ?? ((n: string) => import(n));
  let mod: any;
  try {
    mod = await importer(npm);
  } catch {
    throw configError(`aisdk provider package not bundled: ${npm}. Add it to agent-runtime deps and rebuild the runner image.`);
  }
  const provider = LOADERS[npm](mod, { apiKey, baseURL: opts.config?.baseUrl });
  return provider(opts.modelId);
}
