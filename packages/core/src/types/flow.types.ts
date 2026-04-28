/**
 * Flow JSON schema version. Bumped when flow JSON shape changes
 * incompatibly. ConductorJsonConverter migrates older versions on read.
 */
export const FLOW_SCHEMA_VERSION = 1 as const;
export type FlowSchemaVersion = typeof FLOW_SCHEMA_VERSION;

export type FlowNodeType =
  | "start"
  | "end"
  | "phase"
  // node types reserved for later phases — listed so the converter can reject
  // them in Phase 1 with a clear "not yet supported" error.
  | "gateway-xor"
  | "gateway-and"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch"
  | "human-task";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** Human-readable label shown on the canvas tile. */
  displayName?: string;
  /** Phase type ("analyze", "clone-repos", …) — required when type === "phase". */
  phaseType?: string;
  /** Free-form configuration consumed by the phase handler. */
  config?: Record<string, unknown>;
  /**
   * Common configuration shared by all phases of the same executor kind
   * (e.g. coding-cli phases all carry `{ provider: "claude" | "gemini" | "codex" }`).
   * Kept separate from `config` so phase-specific and kind-shared fields never collide.
   */
  executorConfig?: { provider?: string };
  /** Per-phase retry policy. */
  retry?: RetryPolicy;
  /**
   * Names of env-vars that must be resolved before this node executes.
   * The converter maps each name to an `env:<NAME>` ref in `inputParameters.credentials`.
   */
  requiredSecrets?: string[];
  /** Position on canvas — opaque to engine; preserved on round-trip. */
  position?: { x: number; y: number };
  /** Only meaningful on `end` nodes — surfaced as the run's outcome label. */
  outcome?: string;
}

export type FlowEdgeType = "default" | "conditional" | "error" | "else";

export interface FlowEdge {
  id: string;
  source: string;       // node id
  target: string;       // node id
  type?: FlowEdgeType;  // default = "default"
  /** JSONLogic expression — applies when type === "conditional". */
  condition?: unknown;
  /** Reserved — labels for "then" / "else" outputs of the `if` node. */
  label?: string;
  /** SWITCH branch label — used when type === "conditional" on a gateway-xor or `if`. */
  branchLabel?: string;
}

export interface FlowGraph {
  schemaVersion: FlowSchemaVersion;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Cycle visit-count guard (per spec §4). 0 = no cycles allowed in Phase 1. */
  maxCycleVisits?: number;
}

export interface FlowVersion {
  id: string;
  flowId: string;
  versionNumber: number;
  definition: FlowGraph;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Hydrated from owner grant by the API/store layer:
  scope: FlowScope;
  orgId: string | null;
  ownerUserId: string | null;
  grants?: FlowGrant[];
}

export type FlowScope = "user" | "org" | "global";
export type FlowGrantPrincipalType = FlowScope;
export type FlowGrantRole = "owner" | "editor" | "viewer";

export interface FlowGrant {
  id: string;
  flowId: string;
  principalType: FlowGrantPrincipalType;
  principalId: string | null;
  role: FlowGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

// === Phase 5 additions ===

export type BackoffStrategy = "fixed" | "linear" | "exponential";

export interface RetryPolicy {
  enabled?: boolean;
  maxAttempts?: number;
  backoff?: BackoffStrategy;
  backoffSeconds?: number;
  backoffMultiplier?: number;
  timeoutSeconds?: number;
  retryOn?: string[];
  stopOn?: string[];
  onFailure?: "error-edge" | "fail-flow";
}

export interface FlowRetryPolicy {
  maxAttempts?: number;
  backoffSeconds?: number;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  label?: string;
  source: "builtin" | "provided" | "custom";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface NodeInputBinding {
  from: string;
}
