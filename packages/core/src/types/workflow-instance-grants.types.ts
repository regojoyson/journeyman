export type WorkflowInstanceGrantPrincipalType = "user" | "org" | "global";
export type WorkflowInstanceGrantRole = "owner" | "editor" | "viewer";

export interface WorkflowInstanceGrant {
  id: string;
  workflowInstanceId: string;
  principalType: WorkflowInstanceGrantPrincipalType;
  principalId: string | null;
  role: WorkflowInstanceGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateWorkflowInstanceGrantArgs {
  workflowInstanceId: string;
  principalType: WorkflowInstanceGrantPrincipalType;
  principalId: string | null;
  role: WorkflowInstanceGrantRole;
  createdBy: string | null;
}

export interface ActorContext {
  userId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
  /** "admin" means org admin in caller's current org; affects org-grant elevation. */
  role: "admin" | "member" | null;
}

export type WorkflowInstanceListScope = "mine" | "org" | "all";
