import type { JsonLogicExpr } from "./flow-condition.types.ts";

/**
 * A field the human-task produces. Each declared output becomes a top-level
 * artifact on the node (e.g. `humanTask1.<name>`). Filled by:
 *   - the manual resolve form (one input per output, typed),
 *   - or webhook payload extraction via `fromPath` (dot-path),
 *   - or `timeout.defaults[name]` if the task auto-resolves.
 *
 * The `name` must be unique per node and not collide with the reserved meta
 * keys: "source", "actor", "resolvedAt", "payload".
 */
export interface HumanTaskOutputField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  /** Dot-path into the webhook payload to extract this field's value. */
  fromPath?: string;
}

export interface HumanTaskConfig {
  /** Shown to the human in the UI / notification. */
  prompt?: string;

  /**
   * Fields the human-task produces. Each becomes a top-level artifact.
   * Empty array is allowed — task still pauses + can be resolved with no
   * structured outputs (only meta keys are emitted).
   */
  outputs: HumanTaskOutputField[];

  /** Provider event filter — only events matching these types resolve the task. */
  listensFor?: string[];

  /**
   * JSONLogic expression evaluated against the webhook payload. Event is
   * accepted only when this evaluates truthy. Combine with `and`/`or`/`==`/
   * `in` etc. — the same expression language used by `if` gateways.
   */
  acceptIf?: JsonLogicExpr;

  /** Optional auto-resolve. Off by default. */
  timeout?: {
    duration: string;
    /** Values to fill into declared outputs when the timeout fires. */
    defaults?: Record<string, unknown>;
  };
}

export type HumanTaskSource = "webhook" | "manual" | "timeout";

/**
 * Reserved meta keys that always appear on the resolved node output. Output
 * field names declared in `HumanTaskConfig.outputs` must not collide with
 * any of these.
 */
export const HUMAN_TASK_RESERVED_KEYS = ["source", "actor", "resolvedAt", "payload"] as const;
export type HumanTaskReservedKey = typeof HUMAN_TASK_RESERVED_KEYS[number];

/**
 * Shape of the artifact emitted by a resolved human-task. Declared output
 * fields are spread at the top level; meta keys are also at the top level
 * under reserved names.
 */
export type HumanTaskOutput = {
  source: HumanTaskSource;
  actor: string | null;
  resolvedAt: string;
  /** Raw webhook payload (or `{ ...form values }` for manual / `{}` for timeout). */
  payload: Record<string, unknown>;
} & Record<string, unknown>;
