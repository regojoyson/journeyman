import type { ScanReposOptions, ScanReposResult, CodingModelConfig } from "@journeyman/core";
import { runCustomPrompt } from "./run-custom-prompt.ts";

const SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" }, repoDir: { type: "string" },
          url: { type: "string" }, branch: { type: "string" }, isGitRepo: { type: "boolean" },
        },
        required: ["folderName", "repoDir", "isGitRepo"],
      },
    },
  },
  required: ["repos"],
} as const;

function buildPrompt(parentDir: string): string {
  return [
    `List all immediate subdirectories of: ${parentDir}`,
    "For each subdirectory:",
    "  1. Check if it is a git repo (look for a .git folder inside it)",
    "  2. If it is, get its remote origin URL via: git -C <repoDir> remote get-url origin",
    "  3. If it is, get its current branch via: git -C <repoDir> branch --show-current",
    "Return JSON with a repos array of { folderName, repoDir, isGitRepo, url?, branch? }.",
  ].join("\n");
}

export async function scanRepos(
  opts: ScanReposOptions & { model?: string; modelConfig?: CodingModelConfig },
): Promise<ScanReposResult> {
  const r = await runCustomPrompt({
    prompt: buildPrompt(opts.parentDir),
    outputMode: "structured",
    outputSchema: SCHEMA as unknown as Record<string, unknown>,
    tools: ["bash"],
    model: opts.model,
    modelConfig: opts.modelConfig,
    sessionId: opts.sessionId,
  });
  if (r.error) return { repos: [], sessionId: r.sessionId, error: r.error };
  const structured = (r.structured as { repos?: ScanReposResult["repos"] } | undefined) ?? { repos: [] };
  return { repos: structured.repos ?? [], sessionId: r.sessionId };
}
