import type { BackoffStrategy, WorkflowDefaults, WorkflowNode, RetryPolicy } from "@journeyman/core";
import { useFieldInheritance, type FieldState } from "../hooks/use-field-inheritance.ts";
import { InheritanceChip } from "./InheritanceChip.tsx";
import { FieldInfo, FieldLabel } from "./field-info.tsx";

export interface RetryTabProps {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
  flowDefaults?: WorkflowDefaults;
}

const RETRY_SYSTEM_DEFAULTS = {
  maxAttempts: 3,
  backoff: "exponential" as BackoffStrategy,
  backoffSeconds: 5,
  backoffMultiplier: 2,
  timeoutSeconds: 600,
  onFailure: "error-edge" as RetryPolicy["onFailure"],
};

const BACKOFFS: BackoffStrategy[] = ["fixed", "linear", "exponential"];

const BACKOFF_LABELS: Record<BackoffStrategy, string> = {
  fixed:       "Same delay between every attempt.",
  linear:      "Delay grows by the base seconds on each attempt.",
  exponential: "Delay multiplies by the backoff multiplier each attempt (recommended).",
};

function setRetry(node: WorkflowNode, retry: RetryPolicy): WorkflowNode {
  return { ...node, retry };
}

function chipFor(state: FieldState, onReset: () => void, resolvedValue?: unknown) {
  if (state === "inherited") return <InheritanceChip kind="inherited" inheritedValue={resolvedValue} />;
  if (state === "override")  return <InheritanceChip kind="override" onReset={onReset} />;
  return null;
}

export function RetryTab({ node, onChange, readOnly, flowDefaults }: RetryTabProps) {
  const r = node.retry ?? {};
  const set = (next: RetryPolicy) => onChange(setRetry(node, next));

  const rawDef = flowDefaults?.retry;
  // When the flow has retry defaults configured, fill missing fields with system
  // defaults so phases can show FROM FLOW chips for every field.
  const def = rawDef ? { ...RETRY_SYSTEM_DEFAULTS, ...rawDef } : rawDef;

  const enabledState    = useFieldInheritance(node.retry?.enabled,          def?.enabled);

  const effectiveEnabled = !!(enabledState.resolvedValue ?? r.enabled);
  const backoff = r.backoff ?? "exponential";
  const maxState        = useFieldInheritance(node.retry?.maxAttempts,       def?.maxAttempts);
  const backoffState    = useFieldInheritance(node.retry?.backoff,           def?.backoff);
  const backoffSecState = useFieldInheritance(node.retry?.backoffSeconds,    def?.backoffSeconds);
  const multiplierState = useFieldInheritance(node.retry?.backoffMultiplier, def?.backoffMultiplier);
  const timeoutState    = useFieldInheritance(node.retry?.timeoutSeconds,    def?.timeoutSeconds);
  const onFailState     = useFieldInheritance(node.retry?.onFailure,         def?.onFailure);

  return (
    <div>
      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <label className="je-switch" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={!!(enabledState.resolvedValue ?? r.enabled)}
              disabled={readOnly}
              onChange={e => set({ ...r, enabled: e.target.checked })}
            />
            <span className="je-switch__track" aria-hidden="true">
              <span className="je-switch__thumb" />
            </span>
            <span className="je-switch__label">Retry enabled</span>
          </label>
          {chipFor(enabledState.state, () => set({ ...r, enabled: undefined }), enabledState.resolvedValue)}
          <FieldInfo text="When enabled, the phase re-runs automatically on failure before the flow gives up." />
        </div>
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="Max attempts"
            info="Total number of times this phase can run, including the first attempt. A value of 3 means one initial run plus two retries."
          />
          {chipFor(maxState.state, () => set({ ...r, maxAttempts: undefined }), maxState.resolvedValue)}
        </div>
        <input
          type="number" min={1} max={10}
          value={(maxState.resolvedValue as number | undefined) ?? r.maxAttempts ?? 3}
          disabled={readOnly || !effectiveEnabled}
          onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="Backoff strategy"
            info={BACKOFF_LABELS[backoff]}
          />
          {chipFor(backoffState.state, () => set({ ...r, backoff: undefined }), backoffState.resolvedValue)}
        </div>
        <select
          value={(backoffState.resolvedValue as BackoffStrategy | undefined) ?? backoff}
          disabled={readOnly || !effectiveEnabled}
          onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}
        >
          {BACKOFFS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="Backoff base (seconds)"
            info="How long to wait before the first retry. For exponential backoff this is the starting delay — subsequent waits grow by the multiplier."
          />
          {chipFor(backoffSecState.state, () => set({ ...r, backoffSeconds: undefined }), backoffSecState.resolvedValue)}
        </div>
        <input
          type="number" min={0}
          value={(backoffSecState.resolvedValue as number | undefined) ?? r.backoffSeconds ?? 5}
          disabled={readOnly || !effectiveEnabled}
          onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="Backoff multiplier"
            info="Exponential only — each wait is multiplied by this value. E.g. base 5 s with multiplier 2 gives 5 s → 10 s → 20 s."
          />
          {chipFor(multiplierState.state, () => set({ ...r, backoffMultiplier: undefined }), multiplierState.resolvedValue)}
        </div>
        <input
          type="number" min={1} step={0.1}
          value={(multiplierState.resolvedValue as number | undefined) ?? r.backoffMultiplier ?? 2}
          disabled={readOnly || !effectiveEnabled || backoff !== "exponential"}
          onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="Per-attempt timeout (seconds)"
            info="Maximum time a single attempt may run before it is forcibly stopped and counted as a failure. Applies to every attempt, including retries."
          />
          {chipFor(timeoutState.state, () => set({ ...r, timeoutSeconds: undefined }), timeoutState.resolvedValue)}
        </div>
        <input
          type="number" min={0}
          value={(timeoutState.resolvedValue as number | undefined) ?? r.timeoutSeconds ?? 600}
          disabled={readOnly}
          onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <FieldLabel
            label="On permanent failure"
            info='"Error edge" routes to a recovery path drawn on the canvas. "Fail flow" stops the entire run immediately once all attempts are exhausted.'
          />
          {chipFor(onFailState.state, () => set({ ...r, onFailure: undefined }), onFailState.resolvedValue)}
        </div>
        <select
          value={(onFailState.resolvedValue as RetryPolicy["onFailure"] | undefined) ?? r.onFailure ?? "error-edge"}
          disabled={readOnly}
          onChange={e => set({ ...r, onFailure: e.target.value as RetryPolicy["onFailure"] })}
        >
          <option value="error-edge">Route via error edge</option>
          <option value="fail-flow">Fail the whole flow</option>
        </select>
      </div>
    </div>
  );
}
