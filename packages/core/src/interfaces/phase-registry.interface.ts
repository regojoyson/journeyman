import type { PhaseContext, PhaseInput, PhaseOutput, PhaseFailure } from "../types/phase-handler.types.ts";

export type PhaseRunResult =
  | { kind: "success"; output: PhaseOutput }
  | { kind: "failure"; failure: PhaseFailure };

export interface IPhaseHandler {
  /** Stable phase type id, e.g. "clone-repos". */
  readonly phaseType: string;
  /** JSON Schema describing this phase's required `config` shape. */
  readonly configSchema?: unknown;
  run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult>;
}

export interface IPhaseRegistry {
  register(handler: IPhaseHandler): void;
  get(phaseType: string): IPhaseHandler | null;
  list(): IPhaseHandler[];
}
