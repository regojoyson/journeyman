import type { StepContext, StepInput, StepOutput, StepFailure } from "../types/step-handler.types.ts";

export type StepRunResult =
  | { kind: "success"; output: StepOutput }
  | { kind: "failure"; failure: StepFailure };

export interface IStepHandler {
  /** Stable step type id, e.g. "clone-repos". */
  readonly stepType: string;
  /** JSON Schema describing this step's required `config` shape. */
  readonly configSchema?: unknown;
  /** True ⇒ this step touches the run workspace and should run inside the run's sandbox when one exists. */
  readonly requiresWorkspace?: boolean;
  run(input: StepInput, ctx: StepContext): Promise<StepRunResult>;
}

export interface IStepRegistry {
  register(handler: IStepHandler): void;
  get(stepType: string): IStepHandler | null;
  list(): IStepHandler[];
}
