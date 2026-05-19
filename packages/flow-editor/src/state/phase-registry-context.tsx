// packages/flow-editor/src/state/phase-registry-context.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { PhaseRegistry } from "./phase-registry.ts";
import type { PhaseDefinition } from "../phase-definition.ts";

const PhaseRegistryContext = createContext<PhaseRegistry | null>(null);

export function PhaseRegistryProvider(
  { phases, children }: { phases: PhaseDefinition<any>[]; children: ReactNode },
) {
  const registry = useMemo(() => new PhaseRegistry(phases), [phases]);
  return (
    <PhaseRegistryContext.Provider value={registry}>
      {children}
    </PhaseRegistryContext.Provider>
  );
}

export function usePhaseRegistry(): PhaseRegistry {
  const r = useContext(PhaseRegistryContext);
  if (!r) throw new Error("usePhaseRegistry called outside PhaseRegistryProvider");
  return r;
}
