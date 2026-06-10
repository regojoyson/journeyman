import type { CheckoutEntry, CheckoutRepoOptions, CheckoutRepoResult, CodingModelConfig } from "@journeyman/core";
import { runCustomPrompt } from "./run-custom-prompt.ts";

const SCHEMA = {
  type: "object",
  properties: {
    newBranch: { type: "string" },
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" }, repoDir: { type: "string" },
          baseBranch: { type: "string" }, newBranch: { type: "string" },
          success: { type: "boolean" }, error: { type: "string" },
        },
        required: ["folderName", "repoDir", "baseBranch", "newBranch", "success"],
      },
    },
  },
  required: ["newBranch", "repos"],
} as const;

function normalize(opts: CheckoutRepoOptions): CheckoutEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { repoDir: r, branch: opts.branch ?? "main" } : r));
}

function buildPrompt(entries: CheckoutEntry[], issue: CheckoutRepoOptions["issue"]): string {
  const steps = entries.map(({ repoDir, branch }) => `  - ${repoDir} → baseBranch: ${branch}`).join("\n");
  const naming = issue
    ? `BRANCH NAMING: "{id-lowercased}/{2-4-word-slug}_{unix-seconds}". Issue id: ${issue.id}; title: ${issue.title}.`
    : `BRANCH NAMING: "{animal-themed-slug}_{unix-seconds}" (2-3 words incl. one animal).`;
  return [
    "Sync local repos to origin, then create ONE new feature branch used across all repos.",
    naming,
    "Run `date +%s` ONCE; use that one timestamp for every repo's branch name.",
    "PER REPO: fetch origin; stash -u; checkout <baseBranch>; pull; reset --hard origin/<baseBranch>; clean -fd; checkout -b <newBranch>.",
    "Repos:", steps,
    "Return JSON: { newBranch, repos[]: { folderName, repoDir, baseBranch, newBranch, success, error? } }.",
  ].join("\n");
}

export async function checkoutRepo(
  opts: CheckoutRepoOptions & { model?: string; modelConfig?: CodingModelConfig },
): Promise<CheckoutRepoResult> {
  const entries = normalize(opts);
  if (entries.length === 0) return { repos: [], newBranch: "", sessionId: opts.sessionId };
  const r = await runCustomPrompt({
    prompt: buildPrompt(entries, opts.issue),
    outputMode: "structured",
    outputSchema: SCHEMA as unknown as Record<string, unknown>,
    tools: ["bash"],
    model: opts.model,
    modelConfig: opts.modelConfig,
    sessionId: opts.sessionId,
  });
  if (r.error) return { repos: [], newBranch: "", sessionId: r.sessionId, error: r.error };
  const s = (r.structured as Partial<CheckoutRepoResult> | undefined) ?? {};
  return { repos: s.repos ?? [], newBranch: s.newBranch ?? "", sessionId: r.sessionId };
}
