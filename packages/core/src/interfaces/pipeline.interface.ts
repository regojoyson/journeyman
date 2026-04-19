import type { FastifyInstance } from "fastify";
import type {
  ArtifactHandle, FlowDefinition, PipelineConfig, PipelineEvent, PipelineRun,
  PipelineTrigger, PhaseResult, ProductConfig, TraceLine,
} from "../types/pipeline.types.ts";
import type { ICodingCLI } from "./coding-cli.interface.ts";
import type { IGitProvider } from "./git-provider.interface.ts";
import type { ITicketProvider } from "./ticket.interface.ts";
import type { INotificationProvider } from "./notification.interface.ts";

export interface PipelineContext {
  sessionId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName: string;
  workspaceDir: string;
  signal: AbortSignal;
  productConfig: ProductConfig;
  providers: {
    ticket: ITicketProvider;
    git: IGitProvider;
    coding: ICodingCLI;
    notification: INotificationProvider;
  };
  artifacts: Record<string, unknown>;
  state: Readonly<PipelineRun>;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (event: PipelineEvent) => void;
}

export interface IPhase {
  readonly name: string;
  run(ctx: PipelineContext, stepConfig: unknown): Promise<PhaseResult>;
}

export interface IStateStore {
  load(sessionId: string): Promise<PipelineRun | null>;
  save(run: PipelineRun): Promise<void>;
  /** Delete the stored run record. Returns true if a record was removed. */
  delete(sessionId: string): Promise<boolean>;
  findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]>;
  findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null>;
  find(query: { productId?: string; status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]>;
}

export interface ITraceLogger {
  log(
    sessionId: string,
    stepId: string,
    line: string,
    level?: TraceLine["level"],
    meta?: Record<string, unknown>,
  ): Promise<void>;
  read(sessionId: string, opts?: { stepId?: string; tail?: number }): AsyncIterable<TraceLine>;
  /** Delete all trace logs for a session. No-op if none exist. */
  delete(sessionId: string): Promise<void>;
}

export interface IArtifactStore {
  put(
    sessionId: string,
    key: string,
    data: Buffer | string,
    opts?: { contentType?: string; ext?: string },
  ): Promise<ArtifactHandle>;
  putPath(
    sessionId: string,
    key: string,
    srcPath: string,
    opts?: { contentType?: string },
  ): Promise<ArtifactHandle>;
  get(handle: ArtifactHandle): Promise<Buffer>;
  pathFor(handle: ArtifactHandle): string;
  /** Delete all artifacts stored for a session. No-op if none exist. */
  delete(sessionId: string): Promise<void>;
}

export interface IFlowConfigSource {
  getFlow(name: string): Promise<FlowDefinition>;
  listFlows(): Promise<string[]>;
}

export interface IFlowResolver {
  resolve(trigger: PipelineTrigger): Promise<{ flowName: string; productId: string }>;
}

export type TriggerMountContext = {
  products: Record<string, ProductConfig>;
  webhookConfig: PipelineConfig["server"]["webhooks"];
  onTrigger: (trigger: PipelineTrigger) => void;
};

export interface ITriggerSource {
  readonly id: string;
  mount(app: FastifyInstance, ctx: TriggerMountContext): void;
}
