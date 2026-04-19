/**
 * @file context.ts
 * Factory for assembling a PipelineContext from a run and its runtime dependencies.
 *
 * PipelineContext is the single object passed into every phase's `run()` method.
 * It bundles run identity (sessionId, ticketKey), the shared artifact bag, all
 * four provider instances, storage handles, the event emitter, and the AbortSignal.
 * `buildContext` constructs this object so the Pipeline class stays free of wiring detail.
 */

import type {
  PipelineContext, PipelineRun, PipelineEvent,
  ITraceLogger, IArtifactStore, ProductConfig,
} from "@journeyman/core";
import type { ResolvedProviders } from "./registry/provider-registry.ts";

export function buildContext(args: {
  run: PipelineRun;
  signal: AbortSignal;
  workspaceDir: string;
  productConfig: ProductConfig;
  providers: ResolvedProviders;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (e: PipelineEvent) => void;
}): PipelineContext {
  const { run, signal, workspaceDir, productConfig, providers, trace, artifactStore, emit } = args;
  return {
    sessionId: run.sessionId,
    productId: run.productId,
    ticketKey: run.ticketKey,
    ticketShortKey: run.ticketShortKey,
    flowName: run.flowName,
    workspaceDir,
    signal,
    productConfig,
    providers,
    artifacts: run.artifacts,
    state: run,
    trace,
    artifactStore,
    emit,
  };
}
