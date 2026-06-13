import type { BuildPlan } from "@journeyman/core";

export type BuilderSessionStatus = "active" | "applied" | "archived";

export interface BuilderSessionRecord {
  id: string;
  orgId: string;
  userId: string | null;
  name: string;
  status: BuilderSessionStatus;
  messages: unknown[];
  buildPlan: BuildPlan | null;
  appliedFlowId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuilderSessionInput {
  orgId: string;
  userId: string | null;
  name: string;
  createdBy: string;
  messages?: unknown[];
  buildPlan?: BuildPlan | null;
}

export interface UpdateBuilderSessionInput {
  id: string;
  orgId: string;
  userId: string | null;
  name?: string;
  status?: BuilderSessionStatus;
  messages?: unknown[];
  buildPlan?: BuildPlan | null;
  appliedFlowId?: string | null;
}
