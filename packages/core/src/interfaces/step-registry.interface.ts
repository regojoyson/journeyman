import type { StepContext, StepInput, StepOutput, StepFailure } from "../types/step-handler.types.ts";

export type StepRunResult =
  | { kind: "success"; output: StepOutput }
  | { kind: "failure"; failure: StepFailure };

export interface IStepHandler {
  /** Stable step type id, e.g. "clone-repos". */
  readonly stepType: string;
  /** JSON Schema describing this step's required `config` shape. */
  readonly configSchema?: unknown;
  /** True ⇒ this step always touches the run workspace. */
  readonly requiresWorkspace?: boolean;
  /**
   * Dynamic workspace predicate — evaluated when `requiresWorkspace` is absent or false.
   * Return true if this particular invocation needs the run workspace provisioned.
   * May be async (e.g. to peek a DB row). When both `requiresWorkspace` and
   * `needsWorkspaceFor` are present, either true triggers provisioning.
   */
  needsWorkspaceFor?(input: StepInput): Promise<boolean> | boolean;
  run(input: StepInput, ctx: StepContext): Promise<StepRunResult>;
}

export interface IStepRegistry {
  register(handler: IStepHandler): void;
  get(stepType: string): IStepHandler | null;
  list(): IStepHandler[];
}
