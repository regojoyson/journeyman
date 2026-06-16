import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type PromotableRow } from "../../api/mcp.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface PromoteMcpDialogProps {
  orgId: string;
  promotable: PromotableRow;
  onClose: () => void;
  onPromoted: () => void;
}

export function PromoteMcpDialog(props: PromoteMcpDialogProps) {
  const [name, setName] = useState(props.promotable.name);
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const envVar of props.promotable.bindingEnvVars) {
      // Pre-fill the env var name from the user-scope instance; secret picker stays blank.
      init[envVar] = "";
    }
    setBindings(init);
  }, [props.promotable.id, props.promotable.bindingEnvVars]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = {
      name,
      description: description || undefined,
      systemPrompt: systemPrompt || undefined,
      bindings: Object.entries(bindings)
        .filter(([_k, v]) => v)
        .map(([envVar, secretName]) => ({ envVar, secretName })),
    };
    try {
      await mcpApi.promote(props.orgId, props.promotable.id, body);
      props.onPromoted();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100">Promote to org level</h2>
        <p className="mt-2 text-sm text-slate-400">
          Owner: <code className={codePill}>{props.promotable.ownerEmail}</code>.
          The user-level MCP will be removed. Bindings must be re-mapped to org or global secrets.
        </p>

        <form onSubmit={submit} className="space-y-4 mt-4">
          <input className={inputCls} placeholder="Name in org" required value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          {props.promotable.bindingEnvVars.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-slate-300">
                Re-bind {props.promotable.bindingEnvVars.length} secret(s) to org/global secrets
              </div>
              {Object.keys(bindings).map((envVar) => (
                <div key={envVar} className="flex items-center gap-2">
                  <input
                    className={inputCls + " flex-1 opacity-70 cursor-default"}
                    value={envVar}
                    readOnly
                    title="Env var name (from user-scope binding)"
                  />
                  <span className="text-slate-500">→</span>
                  <div className="flex-1">
                    <SecretPicker
                      orgId={props.orgId}
                      value={bindings[envVar]}
                      onChange={(name) => setBindings((prev) => ({ ...prev, [envVar]: name }))}
                      scope="org-and-global"
                      required
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Promoting…" : "Promote"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
