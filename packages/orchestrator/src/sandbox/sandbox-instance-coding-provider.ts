import type {
  CheckoutRepoOptions, CheckoutRepoResult,
  ExecOp, ExecResult,
  ICodingCLI,
  RunCustomPromptOptions, RunCustomPromptResult,
  ScanReposOptions, ScanReposResult,
} from "@journeyman/core";

type ExecFn = (op: ExecOp) => Promise<ExecResult>;

/** Strip non-serializable fields (callbacks, AbortSignal) before sending opts over the wire. */
function payload(opts: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...opts };
  delete (rest as { onLog?: unknown }).onLog;
  delete (rest as { signal?: unknown }).signal;
  return rest;
}

/**
 * An ICodingCLI that forwards every operation to a run's execution environment
 * (container) via env.exec, instead of running it in-process. Handler logic is
 * unchanged; only the execution location differs.
 */
export class SandboxCodingProvider implements ICodingCLI {
  constructor(private exec: ExecFn, private provider?: string) {}

  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    const r = await this.exec({
      op: "custom-prompt",
      provider: this.provider,
      stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onLog ? { onLog: opts.onLog } : {}),
    });
    if (!r.ok) return { error: r.error ?? "sandbox exec failed" };
    if (typeof r.structured === "string") return { result: r.structured };
    return { structured: r.structured };
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    const r = await this.exec({
      op: "scan-repos",
      provider: this.provider,
      stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!r.ok) return { repos: [], error: r.error };
    return r.structured as ScanReposResult;
  }

  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    const r = await this.exec({
      op: "checkout-repo",
      provider: this.provider,
      stdin: payload(opts as unknown as Record<string, unknown>),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onLog ? { onLog: opts.onLog } : {}),
    });
    if (!r.ok) return { repos: [], newBranch: "", error: r.error };
    return r.structured as CheckoutRepoResult;
  }

}
