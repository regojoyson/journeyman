export interface AiSdkPackage {
  /** The @ai-sdk/* npm package name. Must be bundled into agent-runtime. */
  npm: string;
  /** Human label for the admin dropdown. */
  label: string;
  /** When true, a Base URL is mandatory (the generic OpenAI-compatible adapter). */
  requiresBaseUrl?: boolean;
}

/**
 * The pre-bundled AI-SDK provider packages the `aisdk` coding provider can load.
 * Single source of truth for the admin dropdown, config validation, and the
 * runtime model loader. Adding a vendor here also requires adding the dep to
 * agent-runtime and rebuilding the runner image.
 */
export const AISDK_PROVIDER_PACKAGES: AiSdkPackage[] = [
  { npm: "@ai-sdk/anthropic",         label: "Anthropic (Claude)" },
  { npm: "@ai-sdk/openai",            label: "OpenAI (GPT)" },
  { npm: "@ai-sdk/google",            label: "Google (Gemini)" },
  { npm: "@ai-sdk/openai-compatible", label: "OpenAI-compatible (local / gateway / Azure)", requiresBaseUrl: true },
];

export function isAiSdkPackage(npm: string | undefined): boolean {
  return Boolean(npm) && AISDK_PROVIDER_PACKAGES.some((p) => p.npm === npm);
}
