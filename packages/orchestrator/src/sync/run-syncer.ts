import { createLogger } from "@journeyman/core";
import type {
  IEventBus, IOrchestratorEngine, IRunStore, RunEventType, RunStatus,
} from "@journeyman/core";

const log = createLogger("orchestrator:syncer");

export interface RunSyncerDeps {
  runs: IRunStore;
  orchestrator: IOrchestratorEngine;
  events: IEventBus;
  intervalMs?: number;
}

const NON_TERMINAL: RunStatus[] = ["pending", "running", "paused"];

export class RunSyncer {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private deps: RunSyncerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try { await this.syncOnce(); }
      catch (err) { log.error({ err }, "sync tick failed"); }
      this.timer = setTimeout(tick, this.deps.intervalMs ?? 1500);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Test seam. */
  async syncOnce(): Promise<void> {
    const lists = await Promise.all(
      NON_TERMINAL.map(s => this.deps.runs.list({ status: s, limit: 200 })),
    );
    const allActive = lists.flat();
    for (const r of allActive) {
      const previous = r.status;
      const live = await this.deps.orchestrator.syncStatus(r.id).catch((err) => {
        log.warn({ runId: r.id, err: err?.message }, "syncStatus failed");
        return null;
      });
      if (!live || live === previous) continue;

      const eventType = mapStatusToEvent(live);
      if (eventType) {
        await this.deps.events.append({
          runId: r.id,
          eventType,
          payload: { status: live, previousStatus: previous },
        });
      }
    }
  }
}

function mapStatusToEvent(s: RunStatus): RunEventType | null {
  switch (s) {
    case "running":   return "run.started";
    case "completed": return "run.completed";
    case "failed":    return "run.failed";
    case "cancelled": return "run.cancelled";
    default:          return null;
  }
}
