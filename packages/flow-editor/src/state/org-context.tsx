import { createContext, useContext, type ReactNode } from "react";

const OrgIdContext = createContext<string | null>(null);

export function OrgIdProvider(props: { orgId: string; children: ReactNode }) {
  return <OrgIdContext.Provider value={props.orgId}>{props.children}</OrgIdContext.Provider>;
}

/** Returns the active orgId, or null when used outside the provider. */
export function useOrgId(): string | null {
  return useContext(OrgIdContext);
}
