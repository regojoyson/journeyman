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
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx>({
  activeOrgId: "",
  role: "",
  isPlatformAdmin: false,
  user: null,
  org: null,
  logout: async () => {},
});

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
