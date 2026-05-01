import { useId, useState } from "react";
import type { BackoffStrategy, FlowNode, RetryPolicy } from "@journeyman/core";

export interface RetryTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const BACKOFFS: BackoffStrategy[] = ["fixed", "linear", "exponential"];

const BACKOFF_LABELS: Record<BackoffStrategy, string> = {
  fixed:       "Same delay between every attempt.",
  linear:      "Delay grows by the base seconds on each attempt.",
  exponential: "Delay multiplies by the backoff multiplier each attempt (recommended).",
};

function FieldInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="je-icon-btn-wrap" style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="je-field-info-btn"
        aria-label="More information"
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => e.key === "Escape" && setOpen(false)}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5.5" stroke="currentColor"/>
          <path d="M6 5.5v3M6 3.5v.5" stroke="currentColor" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="je-tooltip je-tooltip--bottom"
          style={{ whiteSpace: "normal", minWidth: 180, maxWidth: 240, right: 0, left: "auto", transform: "none" }}
        >
          <span className="je-tooltip__hint">{text}</span>
        </span>
      )}
    </span>
  );
}

function FieldLabel({ label, info }: { label: string; info: string }) {
  return (
    <div className="je-props__field-label-row">
      <label style={{ marginBottom: 0 }}>{label}</label>
      <FieldInfo text={info} />
    </div>
  );
}

function setRetry(node: FlowNode, retry: RetryPolicy): FlowNode {
  return { ...node, retry };
}

export function RetryTab({ node, onChange, readOnly }: RetryTabProps) {
  const r = node.retry ?? {};
  const set = (next: RetryPolicy) => onChange(setRetry(node, next));
  const backoff = r.backoff ?? "exponential";

  return (
    <div>
      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <label className="je-switch" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={!!r.enabled}
              disabled={readOnly}
              onChange={e => set({ ...r, enabled: e.target.checked })}
            />
            <span className="je-switch__track" aria-hidden="true">
              <span className="je-switch__thumb" />
            </span>
            <span className="je-switch__label">Retry enabled</span>
          </label>
          <FieldInfo text="When enabled, the phase re-runs automatically on failure before the flow gives up." />
        </div>
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="Max attempts"
          info="Total number of times this phase can run, including the first attempt. A value of 3 means one initial run plus two retries."
        />
        <input
          type="number" min={1} max={10}
          value={r.maxAttempts ?? 3}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="Backoff strategy"
          info={BACKOFF_LABELS[backoff]}
        />
        <select
          value={backoff}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}
        >
          {BACKOFFS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="Backoff base (seconds)"
          info="How long to wait before the first retry. For exponential backoff this is the starting delay — subsequent waits grow by the multiplier."
        />
        <input
          type="number" min={0}
          value={r.backoffSeconds ?? 5}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="Backoff multiplier"
          info="Exponential only — each wait is multiplied by this value. E.g. base 5 s with multiplier 2 gives 5 s → 10 s → 20 s."
        />
        <input
          type="number" min={1} step={0.1}
          value={r.backoffMultiplier ?? 2}
          disabled={readOnly || !r.enabled || backoff !== "exponential"}
          onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="Per-attempt timeout (seconds)"
          info="Maximum time a single attempt may run before it is forcibly stopped and counted as a failure. Applies to every attempt, including retries."
        />
        <input
          type="number" min={0}
          value={r.timeoutSeconds ?? 600}
          disabled={readOnly}
          onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <FieldLabel
          label="On permanent failure"
          info='"Error edge" routes to a recovery path drawn on the canvas. "Fail flow" stops the entire run immediately once all attempts are exhausted.'
        />
        <select
          value={r.onFailure ?? "error-edge"}
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
