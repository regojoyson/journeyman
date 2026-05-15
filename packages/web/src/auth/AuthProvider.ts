// packages/web/src/auth/AuthProvider.ts

export interface SessionUser {
  sub: string;
  preferred_username: string;
  name: string | null;
  isPlatformAdmin: boolean;
}

export interface SessionOrg {
  id: string;
  slug?: string;
  name?: string;
}

export interface Session {
  user: SessionUser;
  org: SessionOrg | null;
  role: string;
  exp: number; // unix seconds
}

export interface AuthProviderConfig {
  refreshLeewaySeconds: number; // refresh this many seconds before exp
  idleTimeoutSeconds: number;   // 30 * 60
  idleWarnBeforeSeconds: number; // 60
}

export interface AuthProvider {
  getSession(): Promise<Session | null>;
  refresh(): Promise<Session>;
  login(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;
  readonly config: AuthProviderConfig;
}

export const DEFAULT_AUTH_CONFIG: AuthProviderConfig = {
  refreshLeewaySeconds: 60,
  idleTimeoutSeconds: 2 * 60 * 60,
  idleWarnBeforeSeconds: 60,
};
