// packages/flow-editor/src/state/step-registry-context.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StepRegistry } from "./step-registry.ts";
import type { StepDefinition } from "../step-definition.ts";

const StepRegistryContext = createContext<StepRegistry | null>(null);

export function StepRegistryProvider(
  { steps, children }: { steps: StepDefinition<any>[]; children: ReactNode },
) {
  const registry = useMemo(() => new StepRegistry(steps), [steps]);
  return (
    <StepRegistryContext.Provider value={registry}>
      {children}
    </StepRegistryContext.Provider>
  );
}

export function useStepRegistry(): StepRegistry {
  const r = useContext(StepRegistryContext);
  if (!r) throw new Error("useStepRegistry called outside StepRegistryProvider");
  return r;
}
