import { useEffect, useMemo, useState } from "react";
import type { NodeExecution, WorkflowInstanceEvent } from "@journeyman/core";
import type { PendingHumanTask, ResolvedNodeStatus } from "../types.ts";
import { PhaseLogsSection } from "./PhaseLogsSection.tsx";

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

  // Worker-harness phases do not write NodeExecution rows; their input/output
  // live on phase.started / phase.completed events. Fall back to those when
  // the execution row is missing or has empty fields.
  const nodeEvents = p.events.filter(e => e.nodeId === p.nodeId);
  const lastStarted = [...nodeEvents].reverse().find(e => e.eventType === "phase.started");
  const lastCompleted = [...nodeEvents].reverse().find(e => e.eventType === "phase.completed");
  const startedInput = (lastStarted?.payload as { input?: unknown } | undefined)?.input;
  const completedOutput = (lastCompleted?.payload as { output?: unknown } | undefined)?.output;

  const execInput = lastExec?.input;
  const hasExecInput = execInput && typeof execInput === "object" && Object.keys(execInput as object).length > 0;
  const inputToShow = hasExecInput ? execInput : (startedInput ?? execInput ?? {});
  const outputToShow = lastExec?.output ?? completedOutput ?? null;

  return (
    <aside className="je-runview__drawer">
      <h2>{p.displayName ?? p.nodeId}</h2>
      <div style={{ color: "#aaa", fontSize: 11, marginBottom: 10 }}>
        {p.status ? `${p.status.status} · attempt ${p.status.attempt || 0}` : "no status"}
        {p.status?.durationMs ? ` · ${(p.status.durationMs / 1000).toFixed(1)}s` : ""}
      </div>

      <div className="je-runview__section">
        <h3>Input</h3>
        <pre className="je-runview__pre">{JSON.stringify(inputToShow, null, 2)}</pre>
      </div>

      <div className="je-runview__section">
        <h3>Output</h3>
        {renderOutput(outputToShow)}
      </div>

      {p.status?.errorClass && (
        <div className="je-runview__section">
          <h3>Error</h3>
          <pre className="je-runview__pre" style={{ color: "#ff7675" }}>
            {p.status.errorClass}{lastExec?.errorMessage ? `\n\n${lastExec.errorMessage}` : ""}
          </pre>
        </div>
      )}

      <PhaseLogsSection events={p.events} />

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

const HUMAN_TASK_META_KEYS = new Set(["source", "actor", "resolvedAt", "payload", "comment"]);

function renderOutput(output: unknown) {
  if (output === null || output === undefined) {
    return <pre className="je-runview__pre">—</pre>;
  }
  if (typeof output !== "object" || Array.isArray(output)) {
    return <pre className="je-runview__pre">{JSON.stringify(output, null, 2)}</pre>;
  }
  const entries = Object.entries(output as Record<string, unknown>);
  if (entries.length === 0) {
    return <pre className="je-runview__pre">—</pre>;
  }
  const fields = entries.filter(([k]) => !HUMAN_TASK_META_KEYS.has(k));
  const meta = entries.filter(([k]) => HUMAN_TASK_META_KEYS.has(k));
  return (
    <div className="je-runview__kv">
      {fields.map(([k, v]) => (
        <KvRow key={k} k={k} v={v} />
      ))}
      {fields.length === 0 && (
        <div className="je-runview__kv-val je-runview__kv-val--muted" style={{ gridColumn: "1 / -1" }}>
          (no fields)
        </div>
      )}
      {meta.length > 0 && (
        <div className="je-runview__kv-meta">
          {meta.map(([k, v]) => <KvRow key={k} k={k} v={v} />)}
        </div>
      )}
    </div>
  );
}

function KvRow({ k, v }: { k: string; v: unknown }) {
  let display: string;
  if (v === null || v === undefined) display = "—";
  else if (typeof v === "string") display = v;
  else if (typeof v === "number" || typeof v === "boolean") display = String(v);
  else display = JSON.stringify(v, null, 2);
  const muted = v === null || v === undefined;
  return (
    <>
      <div className="je-runview__kv-key">{k}</div>
      <div className={"je-runview__kv-val" + (muted ? " je-runview__kv-val--muted" : "")}>{display}</div>
    </>
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
