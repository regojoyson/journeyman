import type { AgentLogLevel } from "@journeyman/core";

const VALID_LEVELS: ReadonlySet<string> = new Set(["none", "light", "medium", "all"]);

/**
 * Resolve the `agentLogLevel` from a step node's input map, defaulting to
 * "none" — agent SDK logs are off unless the workflow author explicitly opts in
 * per node. Invalid values fall back to the default rather than throwing, so a
 * misconfigured node still runs (just without verbose logging).
 */
export function resolveAgentLogLevel(raw: unknown): AgentLogLevel {
  if (typeof raw === "string" && VALID_LEVELS.has(raw)) return raw as AgentLogLevel;
  return "none";
}
