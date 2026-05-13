import { createLogger } from "@journeyman/core";
import type {
  CommitPushEntry, ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput,
  PhaseRunResult, ProviderFactory,
} from "@journeyman/core";
import { resolveAgentLogLevel } from "./agent-log-level.ts";

const log = createLogger("worker:commit-push");

/**
 * Accept any of: string | string[] | { repoDir, ... } | { repoDir, ... }[].
 * Returns CommitPushEntry[] (one entry per repo) so the caller can layer
 * a top-level `message` override onto every entry uniformly.
 */
function normalizeRepos(raw: unknown): CommitPushEntry[] | undefined {
  const toEntry = (r: unknown): CommitPushEntry | undefined => {
    if (typeof r === "string" && r.trim().length > 0) return { repoDir: r };
    if (r && typeof r === "object" && !Array.isArray(r)) {
      const o = r as Record<string, unknown>;
      if (typeof o.repoDir === "string" && o.repoDir.length > 0) {
        return {
          repoDir: o.repoDir,
          ...(typeof o.issue === "string" ? { issue: o.issue } : {}),
          ...(typeof o.message === "string" ? { message: o.message } : {}),
        };
      }
    }
    return undefined;
  };
  if (Array.isArray(raw)) {
    const entries: CommitPushEntry[] = [];
    for (const r of raw) {
      const e = toEntry(r);
      if (!e) return undefined;
      entries.push(e);
    }
    return entries.length > 0 ? entries : undefined;
  }
  const single = toEntry(raw);
  return single ? [single] : undefined;
}

export class CommitAndPushPhaseHandler implements IPhaseHandler {
  readonly phaseType = "commit-and-push";
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const entries = normalizeRepos(input.repos);
    if (!entries) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "commit-push requires `repos` as a path string, a string[], a Repo/CommitPushEntry object (with `repoDir`), or an array of them",
          retryable: false,
        },
      };
    }
    const issue = typeof input.issue === "string" ? input.issue : undefined;
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    const overrideMessage = typeof input.message === "string" && input.message.trim().length > 0
      ? input.message.trim()
      : undefined;
    const repos: CommitPushEntry[] = overrideMessage
      ? entries.map((e) => ({ ...e, message: e.message ?? overrideMessage }))
      : entries;
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Commit + push ${repos.length} repo(s)${overrideMessage ? " (literal message)" : ""}`);
    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const result = await coding.commitPushRepos({
      repos,
      issue,
      pattern,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
    });
    if (result?.error) {
      log.error({ result }, "commit-push failed");
      return { kind: "failure", failure: { errorClass: "CommitPushFailed", message: String(result.error), retryable: true } };
    }
    const first = result.repos?.[0];
    return {
      kind: "success",
      output: {
        commitSha: first?.commitSha ?? "",
        pushed: first?.pushed ?? false,
        repos: result.repos,
      },
    };
  }
}
