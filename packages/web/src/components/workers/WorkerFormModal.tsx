import { useEffect, useMemo, useState } from "react";
import { Info, Tag, Server, Star } from "lucide-react";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../../routes/admin-styles.ts";
import {
  workersApi, type Worker, type WorkerType, type WorkerUpsertBody, type WorkerTypeDescriptor,
} from "../../api/workers.ts";
import { Field, CheckField } from "./types/form-controls.tsx";
import { workerTypeForms } from "./types/registry.ts";

export interface WorkerFormModalProps {
  orgId: string;
  scope: "user" | "org";
  /** Present ⇒ edit; absent ⇒ create. */
  worker?: Worker;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkerFormModal(props: WorkerFormModalProps) {
  const editing = Boolean(props.worker);
  const [name, setName] = useState(props.worker?.name ?? "");
  const [type, setType] = useState<WorkerType>(props.worker?.type ?? "local");
  const [isDefault, setIsDefault] = useState(props.worker?.isDefault ?? false);
  const [types, setTypes] = useState<WorkerTypeDescriptor[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>(() =>
    (workerTypeForms[props.worker?.type ?? "local"]?.readConfig(props.worker?.config ?? {}) ?? {}) as Record<string, unknown>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const form = workerTypeForms[type];

  useEffect(() => {
    let alive = true;
    workersApi.listTypes(props.orgId).then((rows) => { if (alive) setTypes(rows); }).catch(() => { if (alive) setTypes([]); });
    return () => { alive = false; };
  }, [props.orgId]);

  // When the user switches type (create mode), reset config to that type's defaults.
  function onSelectType(next: WorkerType) {
    setType(next);
    setTestResult(null);
    const f = workerTypeForms[next];
    setConfig((f?.readConfig(props.worker?.type === next ? (props.worker?.config ?? {}) : {}) ?? {}) as Record<string, unknown>);
  }

  const supportedMode = useMemo(
    () => types.find((t) => t.type === type)?.supportedModes?.[0] ?? (type === "docker" ? "per-instance" : "shared"),
    [types, type],
  );

  async function onTest() {
    if (!form) return;
    setTesting(true); setTestResult(null);
    try {
      setTestResult(await workersApi.testConnection(props.orgId, { type, config: form.buildConfig(config) }));
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error)?.message ?? "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form?.validate) {
      const v = form.validate(config);
      if (v) { setError(v); return; }
    }
    setBusy(true); setError(null);
    const builtConfig = form ? form.buildConfig(config) : {};
    const body: WorkerUpsertBody = {
      name, type,
      executionMode: type === "docker" ? "per-instance" : "shared",
      connectivity: type === "docker" ? "push" : null,
      config: builtConfig,
      isDefault,
    };
    try {
      if (editing) {
        const patch: Partial<WorkerUpsertBody> = {
          name: body.name, executionMode: body.executionMode, connectivity: body.connectivity,
          config: body.config, isDefault: body.isDefault,
        };
        if (props.scope === "user") await workersApi.updateMy(props.orgId, props.worker!.id, patch);
        else await workersApi.updateOrg(props.orgId, props.worker!.id, patch);
      } else if (props.scope === "user") {
        await workersApi.createMy(props.orgId, body);
      } else {
        await workersApi.createOrg(props.orgId, body);
      }
      props.onSaved();
      props.onClose();
    } catch (e2) {
      setError((e2 as Error)?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  const ConfigForm = form?.ConfigForm;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{editing ? "Edit worker" : "New worker"}</h2>
        <div className="flex gap-2 rounded-lg border border-indigo-900/40 bg-indigo-950/30 p-3 mb-4 text-xs leading-relaxed text-slate-300">
          <Info size={16} className="mt-0.5 shrink-0 text-indigo-400" aria-hidden />
          <span>A <b>worker</b> is where a workflow's steps run. Pick a type, then fill its connection/runtime details below.</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field icon={Tag} label="Name" hint={<>A label you'll recognize in the worker picker.</>}>
            <input className={inputCls} placeholder="Local Docker" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field icon={Server} label="Type"
            hint={types.find((t) => t.type === type)?.summary ?? `Mode: ${supportedMode}`}>
            <select className={`${selectCls} block mt-1 w-full`} value={type}
              disabled={editing} onChange={(e) => onSelectType(e.target.value as WorkerType)}>
              {types.map((t) => (
                <option key={t.type} value={t.type} disabled={t.status !== "available"}>
                  {t.label}{t.status !== "available" ? " · coming soon" : ""}
                </option>
              ))}
            </select>
          </Field>

          {ConfigForm
            ? <ConfigForm state={config} onChange={setConfig} editing={editing} />
            : <div className="text-sm text-amber-400">This worker type isn't available yet.</div>}

          {form?.testConnection && (
            <div className="space-y-1">
              <button type="button" onClick={onTest} disabled={testing} className={btnGhost}>
                {testing ? "Testing…" : "Test connection"}
              </button>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {testResult.ok ? "✓ Connected" : `✗ ${testResult.error}`}
                </p>
              )}
            </div>
          )}

          <CheckField icon={Star} label="Set as default worker"
            hint={<>New workflows run on this worker unless they pick a different one.</>}
            checked={isDefault} onChange={setIsDefault} />

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy || !ConfigForm} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
