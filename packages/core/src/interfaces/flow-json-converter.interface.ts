import type { FlowGraph } from "../types/flow.types.ts";

/**
 * Converter between the canonical Journeyman FlowGraph and an
 * engine-specific JSON shape (Conductor in v1, Temporal/Flowable later).
 */
export interface IFlowJsonConverter<TEngineDef = unknown> {
  toEngineJson(def: FlowGraph, opts: {
    /** Stable, unique workflow name for the engine. */
    workflowName: string;
    workflowVersion: number;
  }): TEngineDef;
}
