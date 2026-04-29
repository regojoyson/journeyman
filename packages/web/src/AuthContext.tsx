// packages/web/src/AuthContext.tsx
import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface AuthOrg {
  id: string;
  slug?: string;
  name?: string;
}

export interface AuthCtx {
  activeOrgId: string;
  role: "admin" | "member" | string;
  isPlatformAdmin: boolean;
  user: AuthUser | null;
  org: AuthOrg | null;
  exp: number;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  extend: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx>({
  activeOrgId: "",
  role: "",
  isPlatformAdmin: false,
  user: null,
  org: null,
  exp: 0,
  logout: async () => {},
  refresh: async () => {},
  extend: async () => {},
});

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
