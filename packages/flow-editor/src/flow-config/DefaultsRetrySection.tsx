import { useState } from "react";
import type { BackoffStrategy, WorkflowDefaults, RetryPolicy } from "@journeyman/core";
import { FieldInfo, FieldLabel } from "../properties-panel/field-info.tsx";

const BACKOFFS: BackoffStrategy[] = ["fixed", "linear", "exponential"];

const BACKOFF_LABELS: Record<BackoffStrategy, string> = {
  fixed:       "Same delay between every attempt.",
  linear:      "Delay grows by the base seconds on each attempt.",
  exponential: "Delay multiplies by the backoff multiplier each attempt (recommended).",
};

const RETRY_SYSTEM_DEFAULTS = {
  maxAttempts: 3,
  backoff: "exponential" as BackoffStrategy,
  backoffSeconds: 5,
  backoffMultiplier: 2,
  timeoutSeconds: 600,
  onFailure: "error-edge" as RetryPolicy["onFailure"],
};

function fillMissingFields(r: RetryPolicy): RetryPolicy {
  return {
    maxAttempts:      r.maxAttempts      ?? RETRY_SYSTEM_DEFAULTS.maxAttempts,
    backoff:          r.backoff          ?? RETRY_SYSTEM_DEFAULTS.backoff,
    backoffSeconds:   r.backoffSeconds   ?? RETRY_SYSTEM_DEFAULTS.backoffSeconds,
    backoffMultiplier: r.backoffMultiplier ?? RETRY_SYSTEM_DEFAULTS.backoffMultiplier,
    timeoutSeconds:   r.timeoutSeconds   ?? RETRY_SYSTEM_DEFAULTS.timeoutSeconds,
    onFailure:        r.onFailure        ?? RETRY_SYSTEM_DEFAULTS.onFailure,
    ...r,
  };
}

interface Props {
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsRetrySection({ defaults, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);
  const r = defaults.retry ?? {};
  const set = (next: RetryPolicy) => onChange({ ...defaults, retry: next });

  const backoff = r.backoff ?? "exponential";

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
      >
        {open ? "▾" : "▸"} Default retry policy
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <label className="je-switch" style={{ margin: 0 }}>
                <input type="checkbox" checked={!!r.enabled} disabled={readOnly}
                  onChange={e => set(e.target.checked ? fillMissingFields({ ...r, enabled: true }) : { ...r, enabled: false })} />
                <span className="je-switch__track" aria-hidden><span className="je-switch__thumb" /></span>
                <span className="je-switch__label">Enabled</span>
              </label>
              <FieldInfo text="When enabled, all steps inherit this retry policy unless they override it individually." />
            </div>
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="Max attempts"
                info="Total number of times a step can run, including the first attempt. A value of 3 means one initial run plus two retries."
              />
            </div>
            <input type="number" min={1} max={10} value={r.maxAttempts ?? 3} disabled={readOnly}
              onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })} />
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="Backoff strategy"
                info={BACKOFF_LABELS[backoff]}
              />
            </div>
            <select value={backoff} disabled={readOnly}
              onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}>
              {BACKOFFS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="Backoff base (seconds)"
                info="How long to wait before the first retry. For exponential backoff this is the starting delay — subsequent waits grow by the multiplier."
              />
            </div>
            <input type="number" min={0} value={r.backoffSeconds ?? 5} disabled={readOnly}
              onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })} />
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="Backoff multiplier"
                info="Exponential only — each wait is multiplied by this value. E.g. base 5 s with multiplier 2 gives 5 s → 10 s → 20 s."
              />
            </div>
            <input type="number" min={1} step={0.1}
              value={r.backoffMultiplier ?? 2}
              disabled={readOnly || backoff !== "exponential"}
              onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })} />
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="Per-attempt timeout (seconds)"
                info="Maximum time a single attempt may run before it is forcibly stopped and counted as a failure. Applies to every attempt, including retries."
              />
            </div>
            <input type="number" min={0} value={r.timeoutSeconds ?? 600} disabled={readOnly}
              onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })} />
          </div>

          <div className="je-props__field">
            <div className="je-props__field-label-row">
              <FieldLabel
                label="On permanent failure"
                info='"Error edge" routes to a recovery path drawn on the canvas. "Fail flow" stops the entire run immediately once all attempts are exhausted.'
              />
            </div>
            <select value={r.onFailure ?? "error-edge"} disabled={readOnly}
              onChange={e => set({ ...r, onFailure: e.target.value as RetryPolicy["onFailure"] })}>
              <option value="error-edge">Route via error edge</option>
              <option value="fail-flow">Fail the whole flow</option>
            </select>
          </div>

          <button
            type="button"
            disabled={readOnly}
            onClick={() => onChange({ ...defaults, retry: undefined })}
            style={{ fontSize: 11, color: "#e17055", background: "none", border: "1px solid #4a2020", borderRadius: 3, padding: "2px 8px", cursor: "pointer", marginTop: 4 }}
          >
            Clear retry default
          </button>
        </div>
      )}
    </div>
  );
}
