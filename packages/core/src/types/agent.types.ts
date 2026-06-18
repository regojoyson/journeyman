import type { CanonicalTool } from "./coding-tools.types.ts";
import type { RetryPolicy } from "./flow.types.ts";
import type { CustomStepOutputField } from "./custom-steps.types.ts";

export type AgentScope = "user" | "org";
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

export interface AgentNotifications {
  on: Array<"success" | "failure">;
  /** Phase 2+: the notification Connection to deliver through (delivery lands in Phase 4). */
  connectionId?: string;
  target?: string;
}

export interface AgentBehavior {
  maxTurns?: number;
  timeoutSeconds?: number;
  retry?: RetryPolicy;
}

/** Phase 1 fires only "manual"; webhook/api/schedule modeled for later phases. */
export type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
  | { type: "api"; tokenHash: string }
  | {
      type: "webhook";
      webhookId: string;
      preset?: "jira" | "github";
      event?: string;
      filters?: unknown;
      inputsMapping: Record<string, string>;
    };

export interface Agent {
  id: string;
  scope: AgentScope;
  userId?: string;
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
  outputFields?: CustomStepOutputField[];
  behavior: AgentBehavior;
  triggers: AgentTrigger[];
  status: AgentStatus;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentCreateInput = Pick<Agent, "scope" | "name"> &
  Partial<Omit<Agent, "id" | "scope" | "name" | "orgId" | "userId" | "createdBy" | "createdAt" | "updatedAt">>;

export type AgentUpdateInput = Partial<
  Omit<Agent, "id" | "scope" | "orgId" | "userId" | "createdBy" | "createdAt" | "updatedAt">
>;
