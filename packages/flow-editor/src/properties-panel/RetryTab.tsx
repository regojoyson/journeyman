import type { BackoffStrategy, FlowNode, RetryPolicy } from "@journeyman/core";

export interface RetryTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const BACKOFFS: BackoffStrategy[] = ["fixed", "linear", "exponential"];

function setRetry(node: FlowNode, retry: RetryPolicy): FlowNode {
  return { ...node, retry };
}

export function RetryTab({ node, onChange, readOnly }: RetryTabProps) {
  const r = node.retry ?? {};
  const set = (next: RetryPolicy) => onChange(setRetry(node, next));

  return (
    <div>
      <div className="je-props__field">
        <label className="je-props__check-row">
          <input
            type="checkbox"
            checked={!!r.enabled}
            disabled={readOnly}
            onChange={e => set({ ...r, enabled: e.target.checked })}
          />
          Retry enabled
        </label>
      </div>

      <div className="je-props__field">
        <label>Max attempts</label>
        <input
          type="number" min={1}
          value={r.maxAttempts ?? 3}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <label>Backoff strategy</label>
        <select
          value={r.backoff ?? "exponential"}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}
        >
          {BACKOFFS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="je-props__field">
        <label>Backoff base seconds</label>
        <input
          type="number" min={0}
          value={r.backoffSeconds ?? 5}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <label>Backoff multiplier (exponential)</label>
        <input
          type="number" min={1} step={0.1}
          value={r.backoffMultiplier ?? 2}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <label>Per-attempt timeout (seconds)</label>
        <input
          type="number" min={0}
          value={r.timeoutSeconds ?? 600}
          disabled={readOnly}
          onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <label>Retry only on errors matching (one per line)</label>
        <textarea
          value={(r.retryOn ?? []).join("\n")}
          disabled={readOnly || !r.enabled}
          placeholder="RateLimitError&#10;NetworkError"
          onChange={e => set({ ...r, retryOn: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
        />
      </div>

      <div className="je-props__field">
        <label>Stop on errors matching (one per line)</label>
        <textarea
          value={(r.stopOn ?? []).join("\n")}
          disabled={readOnly}
          placeholder="AuthError&#10;ValidationError"
          onChange={e => set({ ...r, stopOn: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
        />
      </div>

      <div className="je-props__field">
        <label>On permanent failure</label>
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
