import type { JoinMode, JoinNodeOutput, JoinBranchResult } from "@journeyman/core";

/** A loser cancelled by the first-wins-controller has `cancelled: true`. */
function isCancelled(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { cancelled?: unknown }).cancelled === true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Materialize the documented Join output shape from the raw Conductor JOIN
 * branch map. `raw` is keyed by each branch's terminal ref; `branchTaskRefs[i]`
 * is branch i's full node-id chain (head = chain[0], terminal = chain[last]).
 */
export function materializeJoinOutput(
  mode: JoinMode,
  raw: Record<string, unknown>,
  branchTaskRefs: string[][],
): JoinNodeOutput {
  const branches = branchTaskRefs
    .filter((chain) => chain.length > 0)
    .map((chain) => ({ head: chain[0], terminal: chain[chain.length - 1] }));

  if (mode === "wait-all" || mode === "wait-all-strict") {
    const results: Record<string, JoinBranchResult> = {};
    for (const { head, terminal } of branches) {
      results[head] = { status: "success", output: asRecord(raw[terminal]) };
    }
    return { results };
  }

  // first-wins (and any unknown mode defaults here)
  const winnerBranch = branches.find((b) => !isCancelled(raw[b.terminal])) ?? branches[0];
  if (!winnerBranch) return { results: {} };
  const output = asRecord(raw[winnerBranch.terminal]);
  return {
    winner: winnerBranch.head,
    ...(output ? { output } : {}),
    results: { [winnerBranch.head]: { status: "success", output } },
  };
}
