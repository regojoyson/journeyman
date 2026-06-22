import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { WorkflowInputDef } from "@journeyman/core";
import { runFlow } from "../api/flows.ts";
import { btnPrimary, btnGhost, card, inputCls } from "../routes/admin-styles.ts";

export interface RunFlowDialogProps {
  wsId: string;
  workflowId: string;
  workflowName: string;
  /** Input fields declared by the published version's start node (already filtered/resolved). */
  inputDefs: WorkflowInputDef[];
  onClose: () => void;
  /** Called after a run is submitted. If omitted, navigates to the live run view. */
  onSubmitted?: (res: { workflowInstanceId: string; engineWorkflowId: string }) => void;
}

/** Coerce a raw string field value to the type declared by the input def. */
function coerce(def: WorkflowInputDef, raw: string): unknown {
  if (def.type === "number") return Number(raw);
  if (def.type === "boolean") return raw === "true";
  if (def.type === "json-object" || def.type === "json-array") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON for "${def.name}"`);
    }
  }
  return raw;
}

export function RunFlowDialog({ wsId, workflowId, workflowName, inputDefs, onClose, onSubmitted }: RunFlowDialogProps) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = inputDefs.some((d) => d.required && !values[d.name]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, unknown> = {};
      for (const d of inputDefs) inputs[d.name] = coerce(d, values[d.name] ?? "");
      const res = await runFlow(wsId, workflowId, inputs);
      if (onSubmitted) onSubmitted(res);
      else navigate(`/workspaces/${wsId}/workflow-instances/${res.workflowInstanceId}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Run workflow</h2>
            <p className="text-sm text-muted-foreground">{workflowName}</p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {inputDefs.length === 0 ? (
          <p className="text-sm">
            Run <span className="font-medium">{workflowName}</span>? This workflow takes no inputs.
          </p>
        ) : (
          <div className="space-y-3">
            {inputDefs.map((d) => (
              <div key={d.name} className="space-y-1">
                <label className="block text-sm font-medium">
                  {d.name}
                  {d.required && <span className="text-destructive"> *</span>}
                </label>
                {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                {d.type === "boolean" ? (
                  <select
                    className={inputCls}
                    value={values[d.name] ?? ""}
                    onChange={(e) => setField(d.name, e.target.value)}
                  >
                    <option value="">— select —</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className={inputCls}
                    type={d.type === "number" ? "number" : "text"}
                    value={values[d.name] ?? ""}
                    placeholder={d.type === "json-object" ? '{"key": "value"}' : d.type === "json-array" ? "[ ... ]" : undefined}
                    onChange={(e) => setField(d.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="flex justify-end gap-2 border-t pt-4">
          <button className={btnGhost} disabled={busy} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy || missingRequired} onClick={submit}>
            {busy ? "Starting…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
