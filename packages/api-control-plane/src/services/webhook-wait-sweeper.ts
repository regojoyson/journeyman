import type { NodeExecution, WorkflowInstance } from "@journeyman/core";

interface NodeExecutionStoreLike {
  listOverAgePausedNodeExecutions(maxAgeMs: number, limit: number): Promise<NodeExecution[]>;
}

interface WorkflowInstanceStoreLike {
  getById(id: string): Promise<WorkflowInstance | null>;
}

export interface WebhookWaitSweeperOptions {
  /** Max age in ms for a paused webhook-wait. 0 = disabled. */
  maxAgeMs: number;
  /** Tick interval in ms. */
  intervalMs: number;
  /** Max executions resolved per tick. */
  batchSize: number;
  nodeExecutions: NodeExecutionStoreLike;
  workflowInstances: WorkflowInstanceStoreLike;
  /** Fire-handler called once per over-age webhook-wait. Should be idempotent w.r.t. already-resolved nodes. */
  fire: (args: { workflowInstanceId: string; nodeId: string; defaults: Record<string, unknown> }) => Promise<void>;
}

export class WebhookWaitSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: WebhookWaitSweeperOptions) {}

  start(): void {
    if (this.opts.maxAgeMs <= 0) {
      console.log("[webhook-wait-sweeper] disabled by config");
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error("[webhook-wait-sweeper] tick failed:", err));
    }, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.opts.maxAgeMs <= 0) return;

    const rows = await this.opts.nodeExecutions.listOverAgePausedNodeExecutions(
      this.opts.maxAgeMs,
      this.opts.batchSize,
    );

    for (const exec of rows) {
      try {
        const instance = await this.opts.workflowInstances.getById(exec.workflowInstanceId);
        if (!instance) continue;

        const node = instance.definitionSnapshot.nodes.find(n => n.id === exec.nodeId);
        if (!node || node.type !== "webhook-wait") continue;

        const cfg = (node.config ?? {}) as { timeout?: { defaults?: Record<string, unknown> } };
        const defaults = cfg.timeout?.defaults ?? {};

        await this.opts.fire({
          workflowInstanceId: exec.workflowInstanceId,
          nodeId: exec.nodeId,
          defaults,
        });
      } catch (err) {
        console.error(
          `[webhook-wait-sweeper] failed for ${exec.workflowInstanceId}/${exec.nodeId}:`,
          err,
        );
      }
    }
  }
}
