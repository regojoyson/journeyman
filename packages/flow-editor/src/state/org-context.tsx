import { createContext, useContext, type ReactNode } from "react";

const OrgIdContext = createContext<string | null>(null);

export function OrgIdProvider(props: { orgId: string; children: ReactNode }) {
  return <OrgIdContext.Provider value={props.orgId}>{props.children}</OrgIdContext.Provider>;
}

/** Returns the active orgId, or null when used outside the provider. */
export function useOrgId(): string | null {
  return useContext(OrgIdContext);
}

const WsIdContext = createContext<string | null>(null);

export function WsIdProvider(props: { wsId: string; children: ReactNode }) {
  return <WsIdContext.Provider value={props.wsId}>{props.children}</WsIdContext.Provider>;
}

/** Returns the active workspace id, or null when used outside the provider. */
export function useWsId(): string | null {
  return useContext(WsIdContext);
}
