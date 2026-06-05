// packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { CheckoutEntry, CheckoutRepoOptions, CheckoutRepoResult } from "@journeyman/core";

const log = createLogger("opencode:checkout-repo");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    newBranch: { type: "string" },
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          repoDir: { type: "string" },
          baseBranch: { type: "string" },
          newBranch: { type: "string" },
          success: { type: "boolean" },
          error: { type: "string" },
        },
        required: ["folderName", "repoDir", "baseBranch", "newBranch", "success"],
      },
    },
    error: { type: "string" },
  },
  required: ["newBranch", "repos"],
} as const;

const DEFAULT_TOOLS: Record<string, boolean> = { bash: true };

function normalizeEntries(opts: CheckoutRepoOptions): CheckoutEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) =>
    typeof r === "string" ? { repoDir: r, branch: opts.branch ?? "main" } : r,
  );
}

function buildPrompt(entries: CheckoutEntry[], issue: CheckoutRepoOptions["issue"]): string {
  const steps = entries
    .map(({ repoDir, branch }) => `  - ${repoDir} → baseBranch: ${branch}`)
    .join("\n");

  const namingRule = issue
    ? [
        "BRANCH NAMING (issue provided):",
        `  Format: "{id-lowercased}/{2-4-word-slug}_{unix-seconds}"`,
        `  Issue id: ${issue.id}`,
        `  Issue title: ${issue.title}`,
        `  Slug: lowercase ASCII, hyphen-separated, 2-4 meaningful words from the title`,
        `         (strip stopwords like "the", "a", "an", "on", "for", "to", "of", "and").`,
        `  Example: id "EV-12345", title "Fix header alignment bug on checkout page"`,
        `           → "ev-12345/fix-header-alignment_1713542400"`,
      ].join("\n")
    : [
        "BRANCH NAMING (no issue):",
        `  Format: "{animal-themed-slug}_{unix-seconds}"`,
        `  Slug: lowercase ASCII, hyphen-separated, 2-3 words containing one animal name`,
        `         (e.g. "curious-otter-sprint", "swift-falcon-work").`,
      ].join("\n");

  return [
    "You will sync local repos to origin, then create ONE new feature branch used across all repos.",
    "",
    namingRule,
    "",
    "  - Before touching any repo, run `date +%s` ONCE to get the current unix-seconds timestamp.",
    "  - Use that single timestamp value in the branch name for ALL repos. Do NOT re-run `date` inside the per-repo loop.",
    "  - The EXACT same branch name must be used for every repo.",
    "",
    "PER-REPO STEPS (run in order for each repo):",
    "  1. git -C <repoDir> fetch origin",
    "  2. git -C <repoDir> stash --include-untracked   (discard local changes)",
    "  3. git -C <repoDir> checkout <baseBranch>",
    "  4. git -C <repoDir> pull origin <baseBranch>",
    "  5. git -C <repoDir> reset --hard origin/<baseBranch>",
    "  6. git -C <repoDir> clean -fd",
    "  7. git -C <repoDir> checkout -b <newBranch>",
    "",
    "Repos:",
    steps,
    "",
    "Return JSON with:",
    "  - newBranch (top-level): the generated branch name used for all repos",
    "  - repos[]: { folderName, repoDir, baseBranch, newBranch, success, error? }",
    "  - error (top-level, optional): set only if everything failed before per-repo work started",
    "Capture per-repo errors in repos[].error and set success=false for that repo.",
  ].join("\n");
}

export async function checkoutRepo(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: CheckoutRepoOptions,
): Promise<CheckoutRepoResult> {
  const entries = normalizeEntries(opts);
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: CheckoutRepoResult = { repos: [], newBranch: "", sessionId };
  log.info({ sessionId, repoCount: entries.length, ref: opts.issue?.id }, "checkoutRepo start");

  if (entries.length === 0) {
    log.warn({ sessionId }, "checkoutRepo called with no repos");
    return EMPTY;
  }

  const session = await client.session.create({ title: "checkoutRepo" });
  if (!session.data) throw new Error("opencode session.create returned no data");
  const sid = session.data.id;

  const result = await client.session.prompt({
    sessionID: sid,
    parts: [{ type: "text", text: buildPrompt(entries, opts.issue) }],
    model: config.model,
    tools: { ...DEFAULT_TOOLS, ...(config.tools ?? {}) },
    format: { type: "json_schema", schema: OUTPUT_SCHEMA },
  });
  if (!result.data) throw new Error("opencode session.prompt returned no data");

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "checkoutRepo failed");
    return { ...EMPTY, error };
  }
  if (!info.structured) return EMPTY;

  const output = { ...(info.structured as CheckoutRepoResult), sessionId };
  log.info({
    sessionId,
    newBranch: output.newBranch,
    successCount: output.repos.filter((r) => r.success).length,
    failureCount: output.repos.filter((r) => !r.success).length,
  }, "checkoutRepo done");
  return output;
}
