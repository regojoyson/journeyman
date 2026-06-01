export interface ProvisioningReaperDeps {
  /** IDs of runs that have been "provisioning" longer than the timeout. */
  findStuck: () => Promise<string[]>;
  /** Mark a stuck run failed (status + event). */
  failRun: (workflowInstanceId: string) => Promise<void>;
  /** Optional logger. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Fails workflow runs left in "provisioning" past a timeout — e.g. when the api-server
 * crashed mid-provision and the detached runStart() task that owned them is gone.
 */
export class ProvisioningReaper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: ProvisioningReaperDeps) {}

  /** One sweep. Returns the number of runs successfully failed. */
  async reapOnce(): Promise<number> {
    const stuck = await this.deps.findStuck();
    let reaped = 0;
    for (const id of stuck) {
      try {
        await this.deps.failRun(id);
        reaped += 1;
        this.deps.log?.(`failed stuck provisioning run ${id}`, { workflowInstanceId: id });
      } catch (err) {
        this.deps.log?.(`failed to reap provisioning run ${id}`, { workflowInstanceId: id, err: String(err) });
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
