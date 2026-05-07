import { useEffect, useMemo, useState } from "react";
import type { NodeExecution, WorkflowInstanceEvent } from "@journeyman/core";
import type { PendingHumanTask, ResolvedNodeStatus } from "../types.ts";

export interface NodeDetailDrawerProps {
  nodeId: string | null;
  displayName: string | null;
  status: ResolvedNodeStatus | null;
  events: WorkflowInstanceEvent[];
  executions: NodeExecution[];
  onRetryStep?: () => void;
  pendingHumanTask?: PendingHumanTask | null;
  onResolveHumanTask?: (input: {
    nodeId: string;
    values: Record<string, unknown>;
    comment?: string;
    data?: unknown;
  }) => Promise<void>;
}

export function NodeDetailDrawer(p: NodeDetailDrawerProps) {
  if (!p.nodeId) {
    return (
      <aside className="je-runview__drawer">
        <div style={{ color: "#888", textAlign: "center", padding: "24px 12px" }}>
          Click a node to inspect it.
        </div>
      </aside>
    );
  }
  const lastExec = [...p.executions].sort((a, b) => b.attempt - a.attempt)[0] ?? null;
  const logs = p.events.filter(e => e.eventType === "phase.log");

  return (
    <aside className="je-runview__drawer">
      <h2>{p.displayName ?? p.nodeId}</h2>
      <div style={{ color: "#aaa", fontSize: 11, marginBottom: 10 }}>
        {p.status ? `${p.status.status} · attempt ${p.status.attempt || 0}` : "no status"}
        {p.status?.durationMs ? ` · ${(p.status.durationMs / 1000).toFixed(1)}s` : ""}
      </div>

      <div className="je-runview__section">
        <h3>Input</h3>
        <pre className="je-runview__pre">{JSON.stringify(lastExec?.input ?? {}, null, 2)}</pre>
      </div>

      <div className="je-runview__section">
        <h3>Output</h3>
        <pre className="je-runview__pre">
          {lastExec?.output ? JSON.stringify(lastExec.output, null, 2) : "—"}
        </pre>
      </div>

      {p.status?.errorClass && (
        <div className="je-runview__section">
          <h3>Error</h3>
          <pre className="je-runview__pre" style={{ color: "#ff7675" }}>
            {p.status.errorClass}{lastExec?.errorMessage ? `\n\n${lastExec.errorMessage}` : ""}
          </pre>
        </div>
      )}

      <div className="je-runview__section">
        <h3>Logs ({logs.length})</h3>
        <div className="je-runview__log">
          {logs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
          {logs.map(ev => {
            const line = (ev.payload as { line?: string }).line ?? JSON.stringify(ev.payload);
            return <div key={ev.id} className="je-runview__log-line">{line}</div>;
          })}
        </div>
      </div>

      <div className="je-runview__section">
        <h3>Attempts</h3>
        <div className="je-runview__attempts">
          {p.executions.length === 0 && <div style={{ color: "#666" }}>(none yet)</div>}
          {[...p.executions].sort((a, b) => a.attempt - b.attempt).map(e => (
            <div key={e.id} className="je-runview__attempt">
              <span style={{ fontWeight: 600 }}>#{e.attempt}</span>
              <span style={{ color: "#888", marginLeft: 8 }}>{e.status}</span>
              {e.errorClass && <span style={{ color: "#ff7675", marginLeft: 8 }}>{e.errorClass}</span>}
            </div>
          ))}
        </div>
      </div>

      {p.status?.status === "failed" && p.onRetryStep && (
        <div className="je-runview__section">
          <button
            onClick={p.onRetryStep}
            style={{
              background: "#fdcb6e", border: "none", color: "#1a1a24",
              padding: "6px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600,
              cursor: "pointer", width: "100%",
            }}
          >↻ Retry from this step</button>
        </div>
      )}

      {p.pendingHumanTask && p.pendingHumanTask.nodeId === p.nodeId && (
        <HumanTaskResolveForm
          pending={p.pendingHumanTask}
          onResolve={p.onResolveHumanTask}
        />
      )}
    </aside>
  );
}

function HumanTaskResolveForm({
  pending, onResolve,
}: {
  pending: PendingHumanTask;
  onResolve?: (input: {
    nodeId: string;
    values: Record<string, unknown>;
    comment?: string;
    data?: unknown;
  }) => Promise<void>;
}) {
  const initialValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const o of pending.outputs) {
      out[o.name] = o.default ?? "";
    }
    return out;
  }, [pending.nodeId, pending.outputs]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [comment, setComment] = useState<string>("");
  const [data, setData] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setValues(initialValues); }, [initialValues]);

  const setField = (name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
  };

  if (!onResolve) {
    return (
      <div className="je-runview__section">
        <h3>Human Task</h3>
        {pending.prompt && <div style={{ fontSize: 12, marginBottom: 8 }}>{pending.prompt}</div>}
        <div style={{ color: "#888", fontSize: 11 }}>
          Waiting since {new Date(pending.startedAt).toLocaleString()}
        </div>
      </div>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Coerce typed values from form strings.
      const coerced: Record<string, unknown> = {};
      for (const o of pending.outputs) {
        const raw = values[o.name];
        if (raw === undefined || raw === "") continue;
        coerced[o.name] = coerceValue(raw, o.type);
      }
      // Optional structured data (raw JSON).
      let parsedData: unknown = undefined;
      if (data.trim() !== "") {
        try { parsedData = JSON.parse(data); } catch { parsedData = data; }
      }
      await onResolve({
        nodeId: pending.nodeId,
        values: coerced,
        comment: comment || undefined,
        data: parsedData,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="je-runview__section">
      <h3>Human Task</h3>
      {pending.prompt && (
        <div style={{ fontSize: 12, marginBottom: 8, whiteSpace: "pre-wrap" }}>{pending.prompt}</div>
      )}
      <div style={{ color: "#888", fontSize: 11, marginBottom: 8 }}>
        Waiting since {new Date(pending.startedAt).toLocaleString()}
        {pending.timeout && ` · auto-resolves after ${Math.round(pending.timeout.durationMs / 60000)}m`}
      </div>

      {pending.outputs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {pending.outputs.map(o => (
            <div key={o.name} style={{ marginBottom: 6 }}>
              <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>
                {o.label ?? o.name}
                {o.required && <span style={{ color: "#ff7675" }}> *</span>}
                <span style={{ color: "#666", marginLeft: 4 }}>({o.type})</span>
              </label>
              {renderField(o, values[o.name], v => setField(o.name, v))}
              {o.description && (
                <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{o.description}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Comment (optional)</label>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={3}
        style={{ width: "100%", marginBottom: 8 }}
      />

      <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Data (optional, JSON or text)</label>
      <textarea
        value={data}
        onChange={e => setData(e.target.value)}
        rows={3}
        placeholder='{"any": "structured data"}'
        style={{ width: "100%", marginBottom: 8, fontFamily: "ui-monospace, monospace", fontSize: 11 }}
      />

      {error && <div style={{ color: "#ff7675", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button
        type="button"
        disabled={submitting}
        onClick={submit}
        style={{
          background: "#fbc531", border: "none", color: "#1a1a24",
          padding: "6px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600,
          cursor: submitting ? "wait" : "pointer", width: "100%", opacity: submitting ? 0.6 : 1,
        }}
      >{submitting ? "Resolving…" : "Resolve"}</button>
    </div>
  );
}

function renderField(
  output: { name: string; type: "string" | "number" | "boolean" | "json" | "date" },
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const v = value ?? "";
  switch (output.type) {
    case "boolean":
      return (
        <select
          value={String(v)}
          onChange={e => onChange(e.target.value === "true")}
          style={{ width: "100%" }}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof v === "number" ? v : (v as string)}
          onChange={e => onChange(e.target.value)}
          style={{ width: "100%" }}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={String(v)}
          onChange={e => onChange(e.target.value)}
          style={{ width: "100%" }}
        />
      );
    case "json":
      return (
        <textarea
          rows={3}
          value={typeof v === "string" ? v : JSON.stringify(v, null, 2)}
          onChange={e => onChange(e.target.value)}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11 }}
        />
      );
    case "string":
    default:
      return (
        <input
          type="text"
          value={String(v)}
          onChange={e => onChange(e.target.value)}
          style={{ width: "100%" }}
        />
      );
  }
}

function coerceValue(value: unknown, type: "string" | "number" | "boolean" | "json" | "date"): unknown {
  switch (type) {
    case "number":  return typeof value === "number" ? value : Number(value);
    case "boolean": return typeof value === "boolean" ? value : value === "true";
    case "json":
      if (typeof value !== "string") return value;
      try { return JSON.parse(value); } catch { return value; }
    case "string":
    case "date":
    default:
      return value;
  }
}
