import type { ICodingCLI } from "@journeyman/core";
import { ClaudeProvider } from "./claude/index.ts";
import { OpenCodeProvider } from "./opencode/index.ts";
import { AiSdkProvider } from "./aisdk/index.ts";

export interface CreateCodingProviderOpts {
  env: Record<string, string>;
  /** Per-call model override (string; e.g. "claude-sonnet-4-6"). */
  model?: string;
}

/**
 * Single source of truth for constructing a coding provider from a provider key.
 * Used by the in-process worker factory AND the container runner CLI, so adding
 * a provider is one `case` here.
 */
export function createCodingProvider(
  key: string | undefined,
  opts: CreateCodingProviderOpts,
): ICodingCLI {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: opts.env.ANTHROPIC_API_KEY });
    case "opencode":
      // Model arrives per-operation via opts.model ("providerID/modelID"); the
      // managed server spawns the bundled `opencode` binary. Per-call secret env
      // reaches the spawn via process.env (Docker) or applyEnv (local).
      return new OpenCodeProvider({ mode: "managed" });
    case "aisdk":
      if (process.platform === "win32") {
        const err = new Error("the 'aisdk' coding provider is not supported on Windows (it requires bash + ripgrep); use 'claude' or 'opencode'") as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
      // Model + per-vendor credential arrive per-operation via opts.model /
      // opts.modelConfig / opts.env; the provider loads the @ai-sdk package
      // selected by config.npm at run time.
      return new AiSdkProvider();
    default: {
      const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
}
