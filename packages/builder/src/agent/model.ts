import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "@journeyman/core";

type Factory = (mod: any, o: { apiKey?: string; baseURL?: string }) => (modelId: string) => unknown;

const LOADERS: Record<string, Factory> = {
  "@ai-sdk/anthropic":         (m, o) => m.createAnthropic({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai":            (m, o) => m.createOpenAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/google":            (m, o) => m.createGoogleGenerativeAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai-compatible": (m, o) => m.createOpenAICompatible({ name: "builder", baseURL: o.baseURL, apiKey: o.apiKey, supportsStructuredOutputs: true }),
};

export interface BuilderLlmEnv {
  provider?: string; // an @ai-sdk/* npm package name
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolveModelDeps {
  importer?: (npm: string) => Promise<any>;
}

/** Build a provider-agnostic AI-SDK model from BUILDER_LLM_* config. */
export async function resolveBuilderModel(env: BuilderLlmEnv, deps: ResolveModelDeps = {}): Promise<unknown> {
  const npm = env.provider;
  if (!npm || !isAiSdkPackage(npm) || !LOADERS[npm]) {
    throw new Error(`BUILDER_LLM_PROVIDER must be one of: ${AISDK_PROVIDER_PACKAGES.map((p) => p.npm).join(", ")}`);
  }
  if (!env.model) throw new Error("BUILDER_LLM_MODEL is required");
  if (npm === "@ai-sdk/openai-compatible" && !env.baseUrl?.trim()) {
    throw new Error("@ai-sdk/openai-compatible requires BUILDER_LLM_BASE_URL");
  }
  const importer = deps.importer ?? ((n: string) => import(n));
  let mod: any;
  try {
    mod = await importer(npm);
  } catch {
    throw new Error(`Builder LLM provider package not installed: ${npm}`);
  }
  return LOADERS[npm](mod, { apiKey: env.apiKey, baseURL: env.baseUrl })(env.model);
}

export function builderLlmEnvFromProcess(): BuilderLlmEnv {
  return {
    provider: process.env.BUILDER_LLM_PROVIDER,
    model: process.env.BUILDER_LLM_MODEL,
    apiKey: process.env.BUILDER_LLM_API_KEY,
    baseUrl: process.env.BUILDER_LLM_BASE_URL,
  };
}
