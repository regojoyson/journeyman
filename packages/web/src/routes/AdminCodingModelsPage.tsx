import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CodingModel, CodingModelCreateInput } from "@journeyman/core";
import { providersForKind } from "@journeyman/core";
import { codingModelsApi } from "../api/codingModels.ts";

const CODING_PROVIDERS = providersForKind("coding-cli");
import {
  btnGhost,
  btnPrimary,
  btnDanger,
  card,
  inputCls,
} from "./admin-styles.ts";

const EMPTY: CodingModelCreateInput = {
  provider: "claude",
  modelId: "",
  label: "",
  description: "",
  sortOrder: 0,
  enabled: true,
  deprecated: false,
  isDefault: false,
  supportsThinking: false,
};

export function AdminCodingModelsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-coding-models"],
    queryFn: codingModelsApi.adminList,
  });

  const [editing, setEditing] = useState<CodingModel | null>(null);
  const [creating, setCreating] = useState<CodingModelCreateInput | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-coding-models"] });
    qc.invalidateQueries({ queryKey: ["coding-models"] });
  };

  const createMut = useMutation({
    mutationFn: (b: CodingModelCreateInput) => codingModelsApi.adminCreate(b),
    onSuccess: () => { setCreating(null); invalidate(); },
  });
  const updateMut = useMutation({
    mutationFn: (args: { id: string; patch: Partial<CodingModelCreateInput> }) =>
      codingModelsApi.adminUpdate(args.id, args.patch),
    onSuccess: () => { setEditing(null); invalidate(); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => codingModelsApi.adminDelete(id),
    onSuccess: invalidate,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Coding Models</h1>
            <p className="mt-1 text-sm text-slate-400">
              Catalog of AI models available to all flows. Managed by platform admins.
            </p>
          </div>
          <button className={btnPrimary} onClick={() => setCreating({ ...EMPTY })}>
            New model
          </button>
        </header>

        <div className={`${card} overflow-hidden`}>
          {isLoading ? (
            <div className="px-6 py-8 text-slate-400">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Provider</th>
                  <th className="px-4 py-3 text-left font-medium">Model ID</th>
                  <th className="px-4 py-3 text-left font-medium">Label</th>
                  <th className="px-4 py-3 text-left font-medium">Default</th>
                  <th className="px-4 py-3 text-left font-medium">Enabled</th>
                  <th className="px-4 py-3 text-left font-medium">Deprecated</th>
                  <th className="px-4 py-3 text-left font-medium">Context</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(data ?? []).map((m) => (
                  <tr key={m.id} className="hover:bg-slate-900/40 text-slate-200">
                    <td className="px-4 py-3">{m.provider}</td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-300">{m.modelId}</td>
                    <td className="px-4 py-3">{m.label}</td>
                    <td className="px-4 py-3">{m.isDefault ? <span className="text-amber-400">★</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3">{m.enabled ? <span className="text-emerald-400">yes</span> : <span className="text-slate-500">no</span>}</td>
                    <td className="px-4 py-3">{m.deprecated ? <span className="text-rose-400">yes</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 text-slate-300">{m.contextWindow ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button className={btnGhost} onClick={() => setEditing(m)}>Edit</button>
                      <button
                        className={btnDanger}
                        onClick={() => {
                          if (confirm(`Delete ${m.provider}/${m.modelId}?`)) deleteMut.mutate(m.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {(data ?? []).length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                      No models yet — click “New model” to add one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {creating && (
          <ModelForm
            initial={creating}
            title="New model"
            onCancel={() => setCreating(null)}
            onSubmit={(v) => createMut.mutate(v)}
            submitting={createMut.isPending}
          />
        )}
        {editing && (
          <ModelForm
            initial={editing}
            title={`Edit ${editing.provider}/${editing.modelId}`}
            onCancel={() => setEditing(null)}
            onSubmit={(v) => updateMut.mutate({ id: editing.id, patch: v })}
            submitting={updateMut.isPending}
          />
        )}
      </div>
    </div>
  );
}

function ModelForm(props: {
  initial: CodingModelCreateInput | CodingModel;
  title: string;
  onCancel: () => void;
  onSubmit: (v: CodingModelCreateInput) => void;
  submitting?: boolean;
}) {
  const [v, setV] = useState<CodingModelCreateInput>({ ...(props.initial as CodingModelCreateInput) });
  const set = <K extends keyof CodingModelCreateInput>(k: K, val: CodingModelCreateInput[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6`}>
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{props.title}</h2>
          <p className="text-xs text-slate-400 mt-1">
            Rich metadata is optional but helps users pick the right model.
          </p>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Identity</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <select
                className={inputCls}
                value={v.provider}
                onChange={(e) => set("provider", e.target.value)}
              >
                {!CODING_PROVIDERS.some((p) => p.value === v.provider) && v.provider && (
                  <option value={v.provider} disabled>
                    {v.provider} (unknown)
                  </option>
                )}
                {CODING_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model ID">
              <input className={`${inputCls} font-mono text-sm`} value={v.modelId} onChange={(e) => set("modelId", e.target.value)} placeholder="claude-opus-4-7" />
            </Field>
          </div>
          <Field label="Label">
            <input className={inputCls} value={v.label} onChange={(e) => set("label", e.target.value)} placeholder="Claude Opus 4.7" />
          </Field>
          <Field label="Description">
            <textarea className={inputCls} rows={2} value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Capabilities</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sort order">
              <input className={inputCls} type="number" value={v.sortOrder ?? 0} onChange={(e) => set("sortOrder", Number(e.target.value))} />
            </Field>
            <Field label="Context window (tokens)">
              <input
                className={inputCls}
                type="number"
                value={v.contextWindow ?? ""}
                onChange={(e) => set("contextWindow", e.target.value === "" ? undefined : Number(e.target.value))}
                placeholder="200000"
              />
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-200">Flags</h3>
          <Toggle label="Enabled" hint="Available in flow editor dropdowns" checked={v.enabled ?? true} onChange={(b) => set("enabled", b)} />
          <Toggle label="Deprecated" hint="Still available, shown with a deprecated badge" checked={v.deprecated ?? false} onChange={(b) => set("deprecated", b)} />
          <Toggle label="Supports thinking" hint="Model supports extended thinking" checked={v.supportsThinking ?? false} onChange={(b) => set("supportsThinking", b)} />
          <Toggle
            label={`Default for ${v.provider || "provider"}`}
            hint="Used when neither flow nor step picks a model. Replaces the current default."
            checked={v.isDefault ?? false}
            onChange={(b) => {
              if (b && !confirm(`Make this the default for ${v.provider}? It will replace any existing default.`)) return;
              set("isDefault", b);
            }}
          />
        </section>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button className={btnGhost} onClick={props.onCancel} disabled={props.submitting}>Cancel</button>
          <button className={btnPrimary} onClick={() => props.onSubmit(v)} disabled={props.submitting}>
            {props.submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-400"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
