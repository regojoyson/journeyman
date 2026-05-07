import type { SecretScope } from "./secrets.types.ts";
import type { ExecutorKind } from "../registries/provider-catalog.ts";
import type { JsonLogicExpr } from "./flow-condition.types.ts";

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
  | "human-task"
  // node types reserved for later phases — listed so the converter can reject
  // them in Phase 1 with a clear "not yet supported" error.
  | "gateway-xor"
  | "gateway-and"
  | "loop"
  | "subflow"
  | "if"
  | "timer"
  | "retry-block"
  | "try-catch";

export type FlowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string };

export interface RunInputDef {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** Human-readable label shown on the canvas tile. */
  displayName?: string;
  /** Phase type ("analyze-repo", "clone-repos", …) — required when type === "phase". */
  phaseType?: string;
  /** Free-form configuration consumed by the phase handler. */
  config?: Record<string, unknown>;
  /** Wires from upstream nodes / run inputs. Resolved by converter to Conductor refs. */
  inputs?: Record<string, FlowInputValue> | null;
  /**
   * Common configuration shared by all phases of the same executor kind
   * (e.g. coding-cli phases all carry `{ provider: "claude" | "gemini" | "codex" }`).
   * Kept separate from `config` so phase-specific and kind-shared fields never collide.
   */
  executorConfig?: { provider?: string } | null;
  /** Per-phase retry policy. */
  retry?: RetryPolicy | null;
  /**
   * Per-step model override for AI-capable phases.
   * Empty/undefined ⇒ use FlowGraph.defaults.defaultModel, then the system DB default.
   * References coding_models.model_id for the resolved coding provider.
   */
  model?: string | null;
  /** Per-slot binding map. Key is the slot name from the phase definition. */
  secretBindings?: Record<string, SecretBinding> | null;
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
  condition?: JsonLogicExpr;
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
  defaults?: FlowDefaults;
  /** Run-time inputs the caller must supply when starting this flow. */
  inputDefs?: RunInputDef[];
}

export interface FlowVersion {
  id: string;
  flowId: string;
  versionNumber: number;
  definition: FlowGraph;
  createdByUserId: string | null;
  createdAt: Date;
}

export type FlowStatus = "draft" | "ready";

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  status: FlowStatus;

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
  onFailure?: "error-edge" | "fail-flow";
}

export interface FlowRetryPolicy {
  maxAttempts?: number;
  backoffSeconds?: number;
}

export interface FlowDefaults {
  /** Default retry policy. Merged field-by-field into each node's `retry`. */
  retry?: RetryPolicy;
  /**
   * Default executor provider per ExecutorKind.
   * Each phase resolves its default via kindForPhaseType(phaseType).
   */
  executorConfig?: Partial<Record<ExecutorKind, { provider?: string }>>;
  /**
   * Default model for AI-capable phases. Used when a phase node does not set
   * its own `model`. Resolved against coding_models.model_id for the coding
   * provider configured on the phase node.
   */
  defaultModel?: string;
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

/** How a single slot resolves at runtime. */
export type SecretBinding =
  | { mode: "auto" }
  | { mode: "pinned"; scope: SecretScope; name: string };

/**
 * Non-blocking warning returned alongside a successful flow save.
 * The save itself always succeeds when the body is well-formed.
 */
export type FlowSaveWarning =
  | {
      code: "inaccessible_secrets";
      message: string;
      names: string[];
    }
  | {
      code: "cross_scope_pin";
      message: string;
      entries: Array<{
        nodeId: string;
        slot: string;
        pinnedScope: SecretScope;
        flowScope: FlowScope;
      }>;
    }
  | {
      code: "shape-mismatch";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      expected: string;
      actual: string;
    }
  | {
      code: "missing-required";
      message: string;
      nodeId: string;
      inputKey: string;
    }
  | {
      code: "dangling-ref-node";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      missingNodeId: string;
    }
  | {
      code: "dangling-ref-path";
      message: string;
      nodeId: string;
      inputKey: string;
      ref: string;
      missingPath: string;
    }
  | {
      code: "missing-input-shape";
      message: string;
      nodeId: string;
      inputKey: string;
    }
  | {
      code: "unknown_models";
      message: string;
      /** Each entry is a model_id referenced by the flow that isn't enabled in the catalog for the flow's coding provider. */
      entries: Array<{
        location: "flow-default" | "node";
        nodeId?: string;
        provider: string;
        modelId: string;
      }>;
    }
  | {
      code: "deprecated_models";
      message: string;
      entries: Array<{
        location: "flow-default" | "node";
        nodeId?: string;
        provider: string;
        modelId: string;
      }>;
    };