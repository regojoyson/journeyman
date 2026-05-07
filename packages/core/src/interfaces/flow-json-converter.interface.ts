import type { WorkflowGraph } from "../types/flow.types.ts";

/**
 * Converter between the canonical Journeyman WorkflowGraph and an
 * engine-specific JSON shape (Conductor in v1, Temporal/Flowable later).
 */
export interface IWorkflowJsonConverter<TEngineDef = unknown> {
  toEngineJson(def: WorkflowGraph, opts: {
    /** Stable, unique workflow name for the engine. */
    workflowName: string;
    workflowVersion: number;
  }): TEngineDef;
}
