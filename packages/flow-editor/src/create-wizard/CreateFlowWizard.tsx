import { useState } from "react";
import type {
  WorkflowGraph,
  WorkflowInputDef,
  WorkflowAttributeDef,
  WorkflowDefaults,
} from "@journeyman/core";
import {
  type WizardMode,
  type WizardMeta,
  type WizardDraft,
  type WizardStepId,
  type CreateFlowArgs,
  createDraft,
  draftFromGraph,
  stepsForMode,
  canAdvance,
  buildCreateArgs,
} from "./wizard-state.ts";
import { BasicDetailsStep } from "./steps/BasicDetailsStep.tsx";
import { ConfigStep } from "./steps/ConfigStep.tsx";
import { InputsStep } from "./steps/InputsStep.tsx";
import { ReviewStep } from "./steps/ReviewStep.tsx";
import { OrgIdProvider } from "../state/org-context.tsx";

export interface CreateFlowWizardProps {
  mode: WizardMode;
  /** edit mode: seed from the live graph. */
  initialGraph?: WorkflowGraph;
  /** edit mode: meta to seed (only `name` is shown anywhere in edit mode). */
  initialMeta?: WizardMeta;
  /** Active org id — required for the sandbox picker to load options. */
  orgId?: string;
  readOnly?: boolean;
  busy?: boolean;
  error?: string | null;
  /** create mode finish. */
  onCreate?: (args: CreateFlowArgs) => void;
  /** edit mode finish. */
  onSave?: (graph: WorkflowGraph) => void;
  onCancel: () => void;
}

const STEP_TITLES: Record<WizardStepId, string> = {
  basics: "Basic details",
  config: "Workflow config",
  inputs: "Inputs",
  review: "Review",
};

export function CreateFlowWizard(props: CreateFlowWizardProps): JSX.Element {
  const { mode, readOnly, busy } = props;

  const [draft, setDraft] = useState<WizardDraft>(() =>
    mode === "edit" && props.initialGraph
      ? draftFromGraph(props.initialGraph, props.initialMeta ?? { name: "", description: "" })
      : createDraft(),
  );

  const steps = stepsForMode(mode);
  const [stepIdx, setStepIdx] = useState(0);
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  const setMeta = (meta: WizardMeta): void => setDraft(d => ({ ...d, meta }));
  const setDefaults = (defaults: WorkflowDefaults): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, defaults: Object.keys(defaults).length ? defaults : undefined } }));
  const setInputs = (inputDefs: WorkflowInputDef[]): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, inputDefs } }));
  const setAttributes = (attributeDefs: WorkflowAttributeDef[]): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, attributeDefs } }));
  const replaceGraph = (graph: WorkflowGraph): void => setDraft(d => ({ ...d, graph }));

  const finish = (): void => {
    if (mode === "create") props.onCreate?.(buildCreateArgs(draft));
    else props.onSave?.(draft.graph);
  };

  // "Skip to canvas" is allowed in create mode whenever the name gate is satisfied.
  const canSkip = mode === "create" && !readOnly && canAdvance("basics", draft);
  const canNext = canAdvance(step, draft);

  const content = (
    <div className="je-wizard__overlay" role="dialog" aria-modal="true" onClick={props.onCancel}>
      <div className="je-wizard" onClick={e => e.stopPropagation()}>
        <header className="je-wizard__header">
          <ol className="je-wizard__steps">
            {steps.map((s, i) => (
              <li key={s} className={i === stepIdx ? "active" : i < stepIdx ? "done" : ""}>
                {STEP_TITLES[s]}
              </li>
            ))}
          </ol>
          <button type="button" className="je-wizard__close" aria-label="Close" onClick={props.onCancel}>×</button>
        </header>

        <div className="je-wizard__body">
          {step === "basics" && (
            <BasicDetailsStep
              meta={draft.meta}
              onChange={setMeta}
              onReplaceGraph={replaceGraph}
            />
          )}
          {step === "config" && (
            <ConfigStep defaults={draft.graph.defaults ?? {}} onChange={setDefaults} readOnly={readOnly} />
          )}
          {step === "inputs" && (
            <InputsStep graph={draft.graph} onPatchInputs={setInputs} onPatchAttributes={setAttributes} />
          )}
          {step === "review" && <ReviewStep mode={mode} meta={draft.meta} graph={draft.graph} />}
        </div>

        {props.error && <div className="je-wizard__error">{props.error}</div>}

        <footer className="je-wizard__footer">
          <button type="button" onClick={props.onCancel} disabled={busy}>Cancel</button>
          <div className="je-wizard__footer-spacer" />
          {canSkip && !isLast && (
            <button type="button" onClick={finish} disabled={busy}>Skip to canvas</button>
          )}
          {stepIdx > 0 && (
            <button type="button" onClick={() => setStepIdx(i => i - 1)} disabled={busy}>Back</button>
          )}
          {!isLast ? (
            <button type="button" className="primary" onClick={() => setStepIdx(i => i + 1)} disabled={busy || !canNext}>
              Next
            </button>
          ) : (
            <button type="button" className="primary" onClick={finish} disabled={busy || readOnly}>
              {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );

  return props.orgId ? <OrgIdProvider orgId={props.orgId}>{content}</OrgIdProvider> : content;
}
