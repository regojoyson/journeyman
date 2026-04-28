export type RunGrantPrincipalType = "user" | "org" | "global";
export type RunGrantRole = "owner" | "editor" | "viewer";

export interface RunGrant {
  id: string;
  runId: string;
  principalType: RunGrantPrincipalType;
  principalId: string | null;
  role: RunGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

export interface CreateRunGrantArgs {
  runId: string;
  principalType: RunGrantPrincipalType;
  principalId: string | null;
  role: RunGrantRole;
  createdBy: string | null;
}

export interface ActorContext {
  userId: string | null;
  orgId: string | null;
  isPlatformAdmin: boolean;
  /** "admin" means org admin in caller's current org; affects org-grant elevation. */
  role: "admin" | "member" | null;
}

export type RunListScope = "mine" | "org" | "all";
