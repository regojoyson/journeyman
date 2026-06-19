import type { WorkspaceContext } from "./workspace.types.ts";

export type Role = "admin" | "member";

export interface OrgRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string | null;
  status: "active" | "disabled" | "deleted";
  isPlatformAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  createdAt: Date;
}

export interface RunContext {
  user: { id: string; username: string };
  org: { id: string; slug: string };
  membershipId: string;
  role: Role;
  isPlatformAdmin: boolean;
  tokenKind: "access-jwt" | "api-token";
  apiTokenId?: string;
  /** Set by requireWorkspacePermission when a :wsId route resolves. */
  workspace?: WorkspaceContext;
}

export interface AccessTokenClaims {
  sub: string;
  org: string;
  role: Role;
  pa: boolean;        // is_platform_admin (short key for token size)
  kind: "access";
  iat: number;
  exp: number;
}

export class AlreadyBootstrappedError extends Error {
  constructor() { super("System already bootstrapped"); this.name = "AlreadyBootstrappedError"; }
}
export class InvalidCredentialsError extends Error {
  constructor() { super("Invalid credentials"); this.name = "InvalidCredentialsError"; }
}
export class UnauthorizedError extends Error {
  constructor(msg = "Unauthorized") { super(msg); this.name = "UnauthorizedError"; }
}
export class ForbiddenError extends Error {
  constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError"; }
}
