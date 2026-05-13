import type { SecretScope } from "./secrets.types.ts";
import type { ExecutorKind } from "../registries/provider-catalog.ts";
import type { JsonLogicExpr } from "./flow-condition.types.ts";

/**
 * Workflow JSON schema version. Bumped when workflow JSON shape changes
 * incompatibly. ConductorJsonConverter migrates older versions on read.
 */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;
export type WorkflowSchemaVersion = typeof WORKFLOW_SCHEMA_VERSION;

export type WorkflowNodeType =
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

export type WorkflowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string }
  | { kind: "template"; template: string };

export interface WorkflowInputDef {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  /** Human-readable label shown on the canvas tile. */
  displayName?: string;
  /** Phase type ("analyze-repo", "clone-repos", …) — required when type === "phase". */
  phaseType?: string;
  /** Free-form configuration consumed by the phase handler. */
  config?: Record<string, unknown>;
  /** Wires from upstream nodes / workflow inputs. Resolved by converter to Conductor refs. */
  inputs?: Record<string, WorkflowInputValue> | null;
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
   * Empty/undefined ⇒ use WorkflowGraph.defaults.defaultModel, then the system DB default.
   * References coding_models.model_id for the resolved coding provider.
   */
  model?: string | null;
  /** Per-slot binding map. Key is the slot name from the phase definition. */
  secretBindings?: Record<string, SecretBinding> | null;
  /** Position on canvas — opaque to engine; preserved on round-trip. */
  position?: { x: number; y: number };
  /** Only meaningful on `end` nodes — surfaced as the workflow instance's outcome label. */
  outcome?: string;
}

export type WorkflowEdgeType = "default" | "conditional" | "error" | "else";

export interface WorkflowEdge {
  id: string;
  source: string;       // node id
  target: string;       // node id
  type?: WorkflowEdgeType;  // default = "default"
  /** JSONLogic expression — applies when type === "conditional". */
  condition?: JsonLogicExpr;
  /** Reserved — labels for "then" / "else" outputs of the `if` node. */
  label?: string;
  /** SWITCH branch label — used when type === "conditional" on a gateway-xor or `if`. */
  branchLabel?: string;
}

export interface WorkflowGraph {
  schemaVersion: WorkflowSchemaVersion;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Cycle visit-count guard (per spec §4). 0 = no cycles allowed in Phase 1. */
  maxCycleVisits?: number;
  defaults?: WorkflowDefaults;
  /** Run-time inputs the caller must supply when starting this workflow. */
  inputDefs?: WorkflowInputDef[];
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  definition: WorkflowGraph;
  createdByUserId: string | null;
  createdAt: Date;
}

export type WorkflowStatus = "draft" | "ready";

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  status: WorkflowStatus;

  // Hydrated from owner grant by the API/store layer:
  scope: WorkflowScope;
  orgId: string | null;
  ownerUserId: string | null;
  grants?: WorkflowGrant[];
}

export type WorkflowScope = "user" | "org" | "global";
export type WorkflowGrantPrincipalType = WorkflowScope;
export type WorkflowGrantRole = "owner" | "editor" | "viewer";

export interface WorkflowGrant {
  id: string;
  workflowId: string;
  principalType: WorkflowGrantPrincipalType;
  principalId: string | null;
  role: WorkflowGrantRole;
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

export interface WorkflowRetryPolicy {
  maxAttempts?: number;
  backoffSeconds?: number;
}

export interface WorkflowDefaults {
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
 * Non-blocking warning returned alongside a successful workflow save.
 * The save itself always succeeds when the body is well-formed.
 */
export type WorkflowSaveWarning =
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
        workflowScope: WorkflowScope;
      }>;
    }
  | {
      code: "orphan_secret_binding";
      message: string;
      entries: Array<{
        nodeId: string;
        slot: string;
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
        location: "workflow-default" | "node";
        nodeId?: string;
        provider: string;
        modelId: string;
      }>;
    }
  | {
      code: "deprecated_models";
      message: string;
      entries: Array<{
        location: "workflow-default" | "node";
        nodeId?: string;
        provider: string;
        modelId: string;
      }>;
    };