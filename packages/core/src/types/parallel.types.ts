export type JoinMode =
  | "fail-fast"
  | "wait-all"
  | "wait-all-strict"
  | "first-wins";

/**
 * The mode applied when a Join node has no explicit `mode`. Single source of
 * truth — every consumer (UI editor, canvas badge, validation, runtime
 * converter) falls back to this so the displayed and executed defaults agree.
 */
export const DEFAULT_JOIN_MODE: JoinMode = "first-wins";

export interface ForkConfig {
  description?: string;
}

export interface JoinConfig {
  /** How the join waits for branches, cancels losers, and shapes its output. Default: see DEFAULT_JOIN_MODE ("first-wins"). */
  mode?: JoinMode;
  description?: string;
}

export interface JoinBranchResult {
  status: "success" | "error" | "cancelled";
  /** Output of the branch's last node, or null on error/cancellation. */
  output: Record<string, unknown> | null;
  error?: string;
}

/**
 * Shape exposed at runtime as the Join node's output. Which fields are
 * populated depends on the Join's `mode`:
 *   - `fail-fast`: no fields (the workflow either continues with no join
 *     payload or has failed).
 *   - `wait-all` / `wait-all-strict`: `results` keyed by each branch's head
 *     node id.
 *   - `first-wins`: `winner` is the branch head node id and `output` is the
 *     winning branch's last node's output. `results` is present and contains
 *     only the winning branch's entry.
 */
export interface JoinNodeOutput {
  winner?: string;
  output?: Record<string, unknown>;
  results?: Record<string, JoinBranchResult>;
}
