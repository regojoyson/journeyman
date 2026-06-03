import type { SandboxRecord } from "./sandbox-store.ts";

export interface SandboxReaperDeps {
  /** Active tracked sandboxes. */
  listActive: () => Promise<SandboxRecord[]>;
  /** True while the run is still running/non-terminal. */
  isRunActive: (runId: string) => Promise<boolean>;
  /** Destroy the sandbox's container + volume. */
  destroy: (sb: SandboxRecord) => Promise<void>;
  /** Mark the tracking row destroyed. */
  markDestroyed: (runId: string) => Promise<void>;
  /** Optional logger. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Reaps sandboxes whose run is terminal/gone but whose container was left behind. */
export class SandboxReaper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: SandboxReaperDeps) {}

  /** One sweep. Returns the number of sandboxes fully reaped. */
  async reapOnce(): Promise<number> {
    const active = await this.deps.listActive();
    let reaped = 0;
    for (const sb of active) {
      let stillActive: boolean;
      try {
        stillActive = await this.deps.isRunActive(sb.runId);
      } catch {
        continue; // can't determine — leave it for the next sweep
      }
      if (stillActive) continue;
      try {
        await this.deps.destroy(sb);
        await this.deps.markDestroyed(sb.runId);
        reaped += 1;
        this.deps.log?.(`reaped orphaned sandbox for run ${sb.runId}`, { runId: sb.runId });
      } catch (err) {
        this.deps.log?.(`failed to reap sandbox for run ${sb.runId}`, { runId: sb.runId, err: String(err) });
      }
    }
    return reaped;
  }

  /** Start a periodic reap loop. Returns a stop fn. */
  start(intervalMs = 60_000): () => void {
    if (this.timer) return () => this.stop();
    this.timer = setInterval(() => { void this.reapOnce(); }, intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) (this.timer as { unref: () => void }).unref();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
