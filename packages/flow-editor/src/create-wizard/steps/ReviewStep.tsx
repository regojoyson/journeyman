import type { JSX } from "react";
import type { WorkflowGraph } from "@journeyman/core";
import type { WizardMeta, WizardMode } from "../wizard-state.ts";

export interface ReviewStepProps {
  mode: WizardMode;
  meta: WizardMeta;
  graph: WorkflowGraph;
}

export function ReviewStep({ mode, meta, graph }: ReviewStepProps): JSX.Element {
  const defaults = graph.defaults ?? {};
  const inputs = graph.inputDefs ?? [];
  const codingProvider = defaults.executorConfig?.["coding-cli"]?.provider ?? "— none —";
  return (
    <div className="je-wizard__review">
      {mode === "create" && (
        <dl className="je-wizard__summary">
          <dt>Name</dt><dd>{meta.name || "—"}</dd>
        </dl>
      )}
      <dl className="je-wizard__summary">
        <dt>Coding provider</dt><dd>{codingProvider}</dd>
        <dt>Default model</dt><dd>{defaults.defaultModel ?? "— system default —"}</dd>
        <dt>Retry</dt><dd>{defaults.retry?.enabled ? `${defaults.retry.maxAttempts ?? 1} attempts` : "off"}</dd>
        <dt>Inputs</dt>
        <dd>{inputs.length ? inputs.map(i => i.name).join(", ") : "none declared"}</dd>
      </dl>
    </div>
  );
}
