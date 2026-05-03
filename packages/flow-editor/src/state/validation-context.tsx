import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FlowSaveWarning } from "@journeyman/core";

interface ValidationContextValue {
  inputWarnings: FlowSaveWarning[];
}

const ValidationContext = createContext<ValidationContextValue>({ inputWarnings: [] });

export function ValidationProvider({
  inputWarnings,
  children,
}: {
  inputWarnings: FlowSaveWarning[];
  children: ReactNode;
}) {
  const value = useMemo(() => ({ inputWarnings }), [inputWarnings]);
  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}

export function useInputWarnings(): FlowSaveWarning[] {
  return useContext(ValidationContext).inputWarnings;
}

export function useNodeHasWarning(nodeId: string): boolean {
  const warnings = useInputWarnings();
  return warnings.some((w) => "nodeId" in w && w.nodeId === nodeId);
}

export function useNodeWarningsByKey(nodeId: string): Map<string, FlowSaveWarning> {
  const warnings = useInputWarnings();
  return useMemo(() => {
    const out = new Map<string, FlowSaveWarning>();
    for (const w of warnings) {
      if ("nodeId" in w && w.nodeId === nodeId && "inputKey" in w) {
        out.set(w.inputKey, w);
      }
    }
    return out;
  }, [warnings, nodeId]);
}
