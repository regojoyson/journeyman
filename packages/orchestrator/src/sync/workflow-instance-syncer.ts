import { createLogger } from "@journeyman/core";
import type {
  IEventBus, IOrchestratorEngine, IWorkflowInstanceStore,
  WorkflowInstanceEventType, WorkflowInstanceStatus,
} from "@journeyman/core";

const log = createLogger("orchestrator:syncer");

export interface WorkflowInstanceSyncerDeps {
  workflowInstances: IWorkflowInstanceStore;
  orchestrator: IOrchestratorEngine;
  events: IEventBus;
  intervalMs?: number;
  /**
   * Backstop: reconcile a paused instance (cancel first-wins losers, clear
   * waiting rows, recompute status). Injected by api-server since reconcile
   * lives there. Optional so the orchestrator stays standalone.
   */
  reconcilePaused?: (workflowInstanceId: string) => Promise<void>;
}

const NON_TERMINAL: WorkflowInstanceStatus[] = ["pending", "provisioning", "running", "paused"];

export class WorkflowInstanceSyncer {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private deps: WorkflowInstanceSyncerDeps) {}

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

  async syncOnce(): Promise<void> {
    const lists = await Promise.all(
      NON_TERMINAL.map(s => this.deps.workflowInstances.list({ status: s, limit: 200 })),
    );
    const allActive = lists.flat();
    for (const instance of allActive) {
      const previous = instance.status;

      if (previous === "paused" && this.deps.reconcilePaused) {
        await this.deps.reconcilePaused(instance.id).catch((err) => {
          log.warn({ workflowInstanceId: instance.id, err: err?.message }, "reconcilePaused failed");
        });
      }

      const live = await this.deps.orchestrator.syncStatus(instance.id).catch((err) => {
        log.warn({ workflowInstanceId: instance.id, err: err?.message }, "syncStatus failed");
        return null;
      });
      if (!live || live === previous) continue;

      // A paused → running transition is a resume, not a fresh start; don't
      // re-emit workflow_instance.started.
      if (previous === "paused" && live === "running") continue;

      const eventType = mapStatusToEvent(live);
      if (eventType) {
        await this.deps.events.append({
          workflowInstanceId: instance.id,
          eventType,
          payload: { status: live, previousStatus: previous },
        });
      }
    }
  }
}

function mapStatusToEvent(s: WorkflowInstanceStatus): WorkflowInstanceEventType | null {
  switch (s) {
    case "running":   return "workflow_instance.started";
    case "completed": return "workflow_instance.completed";
    case "failed":    return "workflow_instance.failed";
    case "cancelled": return "workflow_instance.cancelled";
    default:          return null;
  }
}
