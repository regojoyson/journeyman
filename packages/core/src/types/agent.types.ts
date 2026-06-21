import type { CanonicalTool } from "./coding-tools.types.ts";
import type { AgentLogLevel } from "./coding.types.ts";
import type { RetryPolicy } from "./flow.types.ts";
import type { CustomStepOutputField } from "./custom-steps.types.ts";

export type AgentStatus = "draft" | "active";

export interface AgentInputField {
  name: string;
  type: "text" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface AgentRepoSelection {
  repo: string; // "owner/name" or clone URL
  branch?: string;
  allowWrites: boolean; // false → claude/* branches only (enforced in later phases)
  /** Phase 2: the git Connection whose credential authenticates this repo's clone/push. */
  connectionId?: string;
}

export interface AgentPermissions {
  allowedTools: CanonicalTool[];
}

export interface AgentNotificationTemplate {
  subject?: string;
  body?: string;
}

export interface AgentNotifications {
  on: Array<"success" | "failure">;
  /** Phase 2+: the notification Connection to deliver through (delivery lands in Phase 4). */
  connectionId?: string;
  target?: string;
  /** Optional per-outcome message templates with {placeholder} substitution.
   *  A blank/absent subject or body falls back to the default text. */
  templates?: {
    success?: AgentNotificationTemplate;
    failure?: AgentNotificationTemplate;
  };
}

export interface AgentBehavior {
  maxTurns?: number;
  timeoutSeconds?: number;
  retry?: RetryPolicy;
  /** Prompt caching for this agent's run. Defaults to true when omitted. */
  caching?: boolean;
}

/**
 * Safety rails (§15.1). Carried per-agent (overrides) and on org settings
 * (defaults). Each field is optional — undefined means "no limit at this level".
 */
export interface AgentSafetyLimits {
  maxConcurrentRuns?: number;
  dailyRunCap?: number;
  budget?: { maxTokens?: number; maxCostUsd?: number };
}

/** Org-level agent settings: the global kill-switch plus default limits. */
export interface OrgAgentSettings {
  orgId: string;
  paused: boolean;
  limits: AgentSafetyLimits;
  updatedAt: string;
}

/** Why a run was not submitted (safety rails). */
export type AgentSkipReason = "paused" | "concurrency" | "daily_cap" | "budget";

/** Phase 1 fires only "manual"; webhook/api/schedule modeled for later phases. */
export type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
  | { type: "api" }
  | {
      type: "webhook";
      webhookId: string;
      listensFor?: string[];
      filters?: unknown;
      inputsMapping: Record<string, string>;
    };

export interface Agent {
  id: string;
  workspaceId: string;
  orgId: string;
  name: string;
  instructions: string; // mustache template using {{input}} vars
  inputs: AgentInputField[];
  provider: string; // "claude" | "opencode" | ...
  model?: string;
  connectorMcpIds: string[];
  tools: CanonicalTool[];
  skillIds: string[];
  repoSelections: AgentRepoSelection[];
  sandboxId?: string;
  permissions: AgentPermissions;
  notifications: AgentNotifications;
  outputMode: "none" | "text" | "structured";
  /** How much coding-CLI transcript streams to run logs. Default "medium". */
  agentLogLevel?: AgentLogLevel;
  outputFields?: CustomStepOutputField[];
  behavior: AgentBehavior;
  /** Per-agent safety overrides (§15.1); merged over org defaults. */
  limits?: AgentSafetyLimits;
  triggers: AgentTrigger[];
  status: AgentStatus;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentCreateInput = Pick<Agent, "name"> &
  Partial<Omit<Agent, "id" | "name" | "orgId" | "workspaceId" | "createdBy" | "createdAt" | "updatedAt">>;

export type AgentUpdateInput = Partial<
  Omit<Agent, "id" | "orgId" | "workspaceId" | "createdBy" | "createdAt" | "updatedAt">
>;
