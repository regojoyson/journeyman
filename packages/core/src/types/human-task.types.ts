/**
 * A field the human-task asks the person to fill in. Each declared output
 * becomes a top-level artifact on the node (e.g. `humanTask1.<name>`).
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
}

/** Where/how to notify a human when the task pauses. */
export interface HumanTaskNotifyConfig {
  /** Notification provider channel — currently "slack" or "console". */
  channel: "slack" | "console";
  /** Free-form target — Slack user id, channel, or email depending on channel. */
  target: string;
  /** Optional override of the message body. The resolve-page link is always appended. */
  message?: string;
}

export interface HumanTaskConfig {
  /** Question/instructions shown to the human. */
  prompt?: string;

  /** Form fields the human fills in. Empty array is allowed (no structured outputs). */
  outputs: HumanTaskOutputField[];

  /** Optional notification dispatched when the task pauses. Best-effort delivery. */
  notify?: HumanTaskNotifyConfig;

  /** Optional auto-resolve. Off by default. */
  timeout?: {
    duration: string;
    /** Values to fill into declared outputs when the timeout fires. */
    defaults?: Record<string, unknown>;
  };
}

export type HumanTaskSource = "manual" | "timeout";

/**
 * Reserved meta keys that always appear on the resolved node output. Output
 * field names declared in `HumanTaskConfig.outputs` must not collide with
 * any of these.
 */
export const HUMAN_TASK_RESERVED_KEYS = ["source", "actor", "resolvedAt", "payload"] as const;
export type HumanTaskReservedKey = typeof HUMAN_TASK_RESERVED_KEYS[number];

export type HumanTaskOutput = {
  source: HumanTaskSource;
  actor: string | null;
  resolvedAt: string;
  /** `{ ...form values }` for manual; `{}` for timeout. */
  payload: Record<string, unknown>;
} & Record<string, unknown>;
