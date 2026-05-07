import { createLogger } from "@journeyman/core";

const log = createLogger("conductor:client");

export interface ConductorClientConfig {
  baseUrl: string;     // e.g. "http://localhost:8080/api"
  fetchImpl?: typeof fetch;
}

export interface PolledTask {
  taskId: string;
  workflowInstanceId: string;
  taskDefName: string;
  /** Unique reference name for this task within the workflow — maps to the flow node ID. */
  referenceTaskName: string;
  inputData: Record<string, unknown>;
  retryCount: number;
}

export interface TaskCompletionBody {
  workflowInstanceId: string;
  taskId: string;
  status: "COMPLETED" | "FAILED" | "FAILED_WITH_TERMINAL_ERROR";
  outputData?: Record<string, unknown>;
  reasonForIncompletion?: string;
}

export class ConductorClient {
  private fetcher: typeof fetch;
  constructor(private cfg: ConductorClientConfig) {
    this.fetcher = cfg.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await this.fetcher(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text();
      log.error({ url, status: res.status, body }, "Conductor request failed");
      throw new Error(`Conductor ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return JSON.parse(text) as T;
    }
    return text as unknown as T;
  }

  /** Register or update a workflow definition. */
  async putWorkflowDef(def: unknown): Promise<void> {
    await this.request("/metadata/workflow", { method: "PUT", body: JSON.stringify([def]) });
  }

  /** Register a task definition (the worker will poll for these). */
  async putTaskDef(def: unknown): Promise<void> {
    await this.request("/metadata/taskdefs", { method: "POST", body: JSON.stringify([def]) });
  }

  /** Start a workflow execution. Returns workflow id. */
  async startWorkflow(args: {
    name: string;
    version?: number;
    input: Record<string, unknown>;
  }): Promise<string> {
    return await this.request<string>("/workflow", {
      method: "POST",
      body: JSON.stringify({
        name: args.name,
        version: args.version,
        input: args.input,
      }),
    });
  }

  async getWorkflow(workflowId: string): Promise<{
    workflowId: string;
    status: "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "PAUSED" | "TIMED_OUT";
    output?: Record<string, unknown>;
  }> {
    return await this.request(`/workflow/${workflowId}?includeTasks=false`);
  }

  async terminate(workflowId: string, reason?: string): Promise<void> {
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    await this.request(`/workflow/${workflowId}${q}`, { method: "DELETE" });
  }

  async pauseWorkflow(workflowId: string): Promise<void> {
    await this.request(`/workflow/${encodeURIComponent(workflowId)}/pause`, { method: "PUT" });
  }

  async resumeWorkflow(workflowId: string): Promise<void> {
    await this.request(`/workflow/${encodeURIComponent(workflowId)}/resume`, { method: "PUT" });
  }

  /** Resume a failed/terminated workflow, optionally from a specific failed task. */
  async retryWorkflow(workflowId: string, opts: { taskId?: string } = {}): Promise<void> {
    const q = opts.taskId ? `?taskId=${encodeURIComponent(opts.taskId)}` : "";
    await this.request(`/workflow/${encodeURIComponent(workflowId)}/retry${q}`, { method: "POST" });
  }

  async pollTask(taskType: string, workerId: string): Promise<PolledTask | null> {
    const r = await this.request<PolledTask | null>(
      `/tasks/poll/${encodeURIComponent(taskType)}?workerid=${encodeURIComponent(workerId)}`,
    );
    return r ?? null;
  }

  async ackTask(taskId: string, workerId: string): Promise<boolean> {
    return await this.request<boolean>(
      `/tasks/${taskId}/ack?workerid=${encodeURIComponent(workerId)}`,
      { method: "POST" },
    );
  }

  async completeTask(body: TaskCompletionBody): Promise<void> {
    await this.request(`/tasks`, { method: "POST", body: JSON.stringify(body) });
  }

  /**
   * Read workflow execution including all task statuses. Used by the engine
   * reconciler to find HUMAN tasks currently in IN_PROGRESS state and capture
   * their `taskId` (which the resolver later passes to `completeTask`).
   */
  async getWorkflowWithTasks(workflowId: string): Promise<{
    workflowId: string;
    status: "RUNNING" | "COMPLETED" | "FAILED" | "TERMINATED" | "PAUSED" | "TIMED_OUT";
    tasks: Array<{
      taskId: string;
      taskType: string;
      referenceTaskName: string;
      status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT" | "SKIPPED";
      inputData?: Record<string, unknown>;
      outputData?: Record<string, unknown>;
    }>;
    output?: Record<string, unknown>;
  }> {
    return await this.request(`/workflow/${encodeURIComponent(workflowId)}?includeTasks=true`);
  }
}
