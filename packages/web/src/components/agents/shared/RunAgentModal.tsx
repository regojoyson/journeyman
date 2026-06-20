import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Agent, AgentInputField } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { btnPrimary, btnGhost, card, inputCls } from "../../../routes/admin-styles.ts";

export interface RunAgentModalProps {
  wsId: string;
  agent: Agent;
  onClose: () => void;
  onStarted?: (workflowInstanceId: string) => void;
}

type FieldValue = string | boolean;

function initialValue(f: AgentInputField): FieldValue {
  if (f.type === "boolean") return typeof f.default === "boolean" ? f.default : false;
  return f.default == null ? "" : String(f.default);
}

export function RunAgentModal({ wsId, agent, onClose, onStarted }: RunAgentModalProps) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(agent.inputs.map((f) => [f.name, initialValue(f)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = agent.inputs.some(
    (f) => f.required && f.type !== "boolean" && String(values[f.name] ?? "").trim() === "",
  );

  const setField = (name: string, value: FieldValue) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const inputs: Record<string, unknown> = {};
      for (const f of agent.inputs) {
        const v = values[f.name];
        inputs[f.name] = f.type === "number" ? Number(v) : v;
      }
      const { workflowInstanceId } = await agentsApi.runNow(wsId, agent.id, inputs);
      if (onStarted) onStarted(workflowInstanceId);
      else navigate(`/workspaces/${wsId}/agent-runs/${workflowInstanceId}`);
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
            <h2 className="text-lg font-semibold">Run agent</h2>
            <p className="text-sm text-muted-foreground">{agent.name}</p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {agent.inputs.length === 0 ? (
          <p className="text-sm">
            Run <span className="font-medium">{agent.name}</span>? This agent takes no inputs.
          </p>
        ) : (
          <div className="space-y-3">
            {agent.inputs.map((f) => (
              <div key={f.name} className="space-y-1">
                <label className="block text-sm font-medium">
                  {f.name}
                  {f.required && <span className="text-destructive"> *</span>}
                </label>
                {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                {f.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={values[f.name] === true}
                    onChange={(e) => setField(f.name, e.target.checked)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={f.type === "number" ? "number" : "text"}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => setField(f.name, e.target.value)}
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
