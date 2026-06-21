import type { JSX } from "react";
import type { WorkflowGraph, WorkflowInputDef, WorkflowAttributeDef } from "@journeyman/core";
import { InputsTab } from "../../inputs-tab/InputsTab.tsx";
import { inputNameWarnings } from "../wizard-state.ts";

export interface InputsStepProps {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
  onPatchAttributes: (next: WorkflowAttributeDef[]) => void;
}

export function InputsStep({ graph, onPatchInputs, onPatchAttributes }: InputsStepProps): JSX.Element {
  const warnings = inputNameWarnings(graph);
  return (
    <div className="je-wizard__inputs">
      <InputsTab graph={graph} onPatchInputs={onPatchInputs} onPatchAttributes={onPatchAttributes} />
      {warnings.length > 0 && (
        <ul className="je-wizard__warnings">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
