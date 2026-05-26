import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WorkflowSaveWarning } from "@journeyman/core";
import type { ValidationIssue } from "./validation.ts";

interface ValidationContextValue {
  inputWarnings: WorkflowSaveWarning[];
  graphIssues: ValidationIssue[];
}

const ValidationContext = createContext<ValidationContextValue>({
  inputWarnings: [],
  graphIssues: [],
});

export function ValidationProvider({
  inputWarnings,
  graphIssues,
  children,
}: {
  inputWarnings: WorkflowSaveWarning[];
  graphIssues: ValidationIssue[];
  children: ReactNode;
}) {
  const value = useMemo(() => ({ inputWarnings, graphIssues }), [inputWarnings, graphIssues]);
  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}

export function useInputWarnings(): WorkflowSaveWarning[] {
  return useContext(ValidationContext).inputWarnings;
}

export function useNodeHasWarning(nodeId: string): boolean {
  const warnings = useInputWarnings();
  return warnings.some((w) => "nodeId" in w && w.nodeId === nodeId);
}

export function useNodeWarningsByKey(nodeId: string): Map<string, WorkflowSaveWarning> {
  const warnings = useInputWarnings();
  return useMemo(() => {
    const out = new Map<string, WorkflowSaveWarning>();
    for (const w of warnings) {
      if ("nodeId" in w && w.nodeId === nodeId && "inputKey" in w) {
        out.set(w.inputKey, w);
      }
    }
    return out;
  }, [warnings, nodeId]);
}

export function useNodeIssues(nodeId: string): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const { inputWarnings, graphIssues } = useContext(ValidationContext);
  return useMemo(() => {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    for (const issue of graphIssues) {
      if (issue.nodeId !== nodeId) continue;
      if (issue.severity === "error") errors.push(issue);
      else warnings.push(issue);
    }
    for (const w of inputWarnings) {
      if ("nodeId" in w && w.nodeId === nodeId) {
        warnings.push({
          severity: "warning",
          message: "message" in w ? w.message : "Input validation warning",
          nodeId,
        });
      }
    }
    return { errors, warnings };
  }, [graphIssues, inputWarnings, nodeId]);
}
