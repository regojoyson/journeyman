import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CodingModel, CodingModelCreateInput } from "@journeyman/core";
import { providersForKind, AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "@journeyman/core";
import { codingModelsApi } from "../api/codingModels.ts";
import { modelPricingApi } from "../api/modelPricing.ts";
import { activePriceFor } from "./coding-model-pricing.ts";
import { listOrgSecrets, createOrgSecret, type OrgSecretMeta } from "../api/secrets.ts";

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
  config: {},
};

export function AdminCodingModelsPage() {
  const qc = useQueryClient();
  const { orgId = "" } = useParams<{ orgId: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["org-coding-models", orgId],
    queryFn: () => codingModelsApi.orgList(orgId),
    enabled: !!orgId,
  });
  const { data: prices = [] } = useQuery({
    queryKey: ["model-pricing", orgId],
    queryFn: () => modelPricingApi.orgList(orgId),
    enabled: !!orgId,
  });
  const pricedKeys = new Set(
    prices.filter((p) => p.effectiveTo === null).map((p) => `${p.provider}/${p.model}`),
  );

  const [editing, setEditing] = useState<CodingModel | null>(null);
  const [creating, setCreating] = useState<CodingModelCreateInput | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org-coding-models", orgId] });
    qc.invalidateQueries({ queryKey: ["coding-models"] });
    qc.invalidateQueries({ queryKey: ["model-pricing", orgId] });
  };

  const createMut = useMutation({
    mutationFn: (b: CodingModelCreateInput) => codingModelsApi.orgCreate(orgId, b),
    onSuccess: () => { setCreating(null); invalidate(); },
  });
  const updateMut = useMutation({
    mutationFn: (args: { id: string; patch: Partial<CodingModelCreateInput> }) =>
      codingModelsApi.orgUpdate(orgId, args.id, args.patch),
    onSuccess: () => { setEditing(null); invalidate(); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => codingModelsApi.orgDelete(orgId, id),
    onSuccess: invalidate,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Coding Models</h1>
            <p className="mt-1 text-sm text-slate-400">
              Models available to this org's flows and agents.
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
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Provider</th>
                  <th className="px-4 py-3 text-left font-medium">Model ID</th>
                  <th className="px-4 py-3 text-left font-medium">Label</th>
                  <th className="px-4 py-3 text-left font-medium">Default</th>
                  <th className="px-4 py-3 text-left font-medium">Enabled</th>
                  <th className="px-4 py-3 text-left font-medium">Deprecated</th>
                  <th className="px-4 py-3 text-left font-medium">Context</th>
                  <th className="px-4 py-3 text-left font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {(data ?? []).map((m) => (
                  <tr key={m.id} className="hover:bg-surface-hover text-slate-200">
                    <td className="px-4 py-3">{m.provider}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{m.modelId}</td>
                    <td className="px-4 py-3">{m.label}</td>
                    <td className="px-4 py-3">{m.isDefault ? <span className="text-warning">★</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3">{m.enabled ? <span className="text-success">yes</span> : <span className="text-slate-500">no</span>}</td>
                    <td className="px-4 py-3">{m.deprecated ? <span className="text-danger">yes</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 text-slate-300">{m.contextWindow ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3">
                      {pricedKeys.has(`${m.provider}/${m.modelId}`)
                        ? <span className="text-success">✓</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
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
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={9}>
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
            orgId={orgId}
            title="New model"
            onCancel={() => setCreating(null)}
            onSubmit={(v) => createMut.mutate(v)}
            submitting={createMut.isPending}
          />
        )}
        {editing && (
          <ModelForm
            initial={editing}
            orgId={orgId}
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
  orgId: string;
  title: string;
  onCancel: () => void;
  onSubmit: (v: CodingModelCreateInput) => void;
  submitting?: boolean;
}) {
  const [v, setV] = useState<CodingModelCreateInput>({ ...(props.initial as CodingModelCreateInput) });
  const set = <K extends keyof CodingModelCreateInput>(k: K, val: CodingModelCreateInput[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));
  const setConfig = (k: "baseUrl" | "npm", val: string) =>
    setV((prev) => ({ ...prev, config: { ...(prev.config ?? {}), [k]: val || undefined } }));
  const setApiKeySecretId = (id: string | undefined) =>
    setV((prev) => ({ ...prev, apiKeySecretId: id || undefined }));
  const requiresKey = Boolean(v.config?.requiresApiKey);
  const setRequiresKey = (b: boolean) =>
    setV((prev) => ({
      ...prev,
      apiKeySecretId: b ? prev.apiKeySecretId : undefined,
      config: { ...(prev.config ?? {}), requiresApiKey: b || undefined },
    }));

  const { data: orgSecrets = [] } = useQuery({
    queryKey: ["org-secrets", props.orgId],
    queryFn: () => listOrgSecrets(props.orgId),
    enabled: !!props.orgId,
  });

  const { data: orgPrices = [] } = useQuery({
    queryKey: ["model-pricing", props.orgId],
    queryFn: () => modelPricingApi.orgList(props.orgId),
    enabled: !!props.orgId,
  });

  type RateKey = "inputPer1m" | "outputPer1m" | "cacheReadPer1m" | "cacheCreationPer1m" | "reasoningPer1m";
  const setPrice = (k: RateKey, raw: string) =>
    setV((prev) => ({
      ...prev,
      pricing: { ...(prev.pricing ?? {}), [k]: raw.trim() === "" ? null : Number(raw) },
    }));

  const isEdit = "id" in props.initial;
  useEffect(() => {
    if (!isEdit || v.pricing !== undefined) return;
    const active = activePriceFor(orgPrices, v.provider, v.modelId);
    if (active) setV((prev) => ({ ...prev, pricing: active }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgPrices, isEdit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
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
            <Field
              label="Model ID"
              info={v.provider === "opencode" ? (
                <>
                  <p className="font-medium text-slate-200">
                    Format: <code>providerID/modelID</code>
                  </p>
                  <div>
                    <p className="text-slate-400">Cloud providers (built-in, key only):</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-300">
                      <li>anthropic/claude-sonnet-4-6</li>
                      <li>openai/gpt-4o</li>
                      <li>google/gemini-2.0-flash</li>
                      <li>openrouter/meta-llama/llama-3.1-70b</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-slate-400">
                      Custom endpoint (set Base URL below; the providerID is a name you choose):
                    </p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-300">
                      <li>lmstudio/llama-3.1</li>
                      <li>ollama/llama3.1</li>
                    </ul>
                  </div>
                </>
              ) : v.provider === "aisdk" ? (
                <>
                  <p className="font-medium text-slate-200">
                    Just the vendor's model id — <em>not</em> <code>providerID/modelID</code>.
                  </p>
                  <p className="text-slate-400">
                    The vendor is chosen by the <strong>npm package</strong> field below; the Model ID is
                    whatever that vendor (or your endpoint) calls the model.
                  </p>
                  <div>
                    <p className="text-slate-400">Examples by package:</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-300">
                      <li>@ai-sdk/anthropic → claude-sonnet-4-6</li>
                      <li>@ai-sdk/openai → gpt-5.3</li>
                      <li>@ai-sdk/google → gemini-2.5-pro</li>
                      <li>@ai-sdk/openai-compatible → llama-3.3-70b (set Base URL)</li>
                    </ul>
                  </div>
                </>
              ) : undefined}
            >
              <input
                className={`${inputCls} font-mono text-sm`}
                value={v.modelId}
                onChange={(e) => set("modelId", e.target.value)}
                placeholder={
                  v.provider === "opencode"
                    ? "anthropic/claude-sonnet-4-6"
                    : v.provider === "aisdk"
                    ? "claude-sonnet-4-6"
                    : "claude-opus-4-7"
                }
              />
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

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Pricing</h3>
          <p className="text-xs text-slate-400">
            USD per 1M tokens — optional. Changing a saved price supersedes the old one going forward;
            past usage keeps its cost.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Input / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.inputPer1m ?? ""}
                onChange={(e) => setPrice("inputPer1m", e.target.value)} placeholder="15" />
            </Field>
            <Field label="Output / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.outputPer1m ?? ""}
                onChange={(e) => setPrice("outputPer1m", e.target.value)} placeholder="75" />
            </Field>
            <Field label="Cache read / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.cacheReadPer1m ?? ""}
                onChange={(e) => setPrice("cacheReadPer1m", e.target.value)} placeholder="1.5" />
            </Field>
            <Field label="Cache write / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.cacheCreationPer1m ?? ""}
                onChange={(e) => setPrice("cacheCreationPer1m", e.target.value)} placeholder="18.75" />
            </Field>
            <Field label="Reasoning / 1M">
              <input className={inputCls} type="number" step="0.0001" min="0"
                value={v.pricing?.reasoningPer1m ?? ""}
                onChange={(e) => setPrice("reasoningPer1m", e.target.value)} placeholder="(often = output)" />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Authentication</h3>
          <Toggle
            label="Requires an API key"
            hint="Bind an org secret here; workflows and agents using this model will use it automatically."
            checked={requiresKey}
            onChange={setRequiresKey}
          />
          {requiresKey && (
            <SecretBindingField
              orgId={props.orgId}
              secrets={orgSecrets}
              value={v.apiKeySecretId}
              onChange={setApiKeySecretId}
            />
          )}
        </section>

        {(v.provider === "opencode" || v.provider === "aisdk") && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-200">Custom endpoint (optional)</h3>
            <p className="text-xs text-slate-400">
              Leave blank for cloud models (Claude, OpenAI, Gemini) — they use built-in defaults.
              Fill in for local/self-hosted endpoints. Inside Docker, <code>localhost</code> is the
              container — use <code>host.docker.internal</code> or a reachable service address.
              {v.provider === "aisdk" && (
                <> Base URL is <strong>required</strong> when the npm package is{" "}
                <code>@ai-sdk/openai-compatible</code>.</>
              )}
            </p>
            <Field label="Base URL">
              <input
                className={`${inputCls} font-mono text-sm`}
                value={v.config?.baseUrl ?? ""}
                onChange={(e) => setConfig("baseUrl", e.target.value)}
                placeholder="http://host.docker.internal:1234/v1"
              />
            </Field>
            <Field label="npm package">
              <select
                className={inputCls}
                value={v.config?.npm ?? ""}
                onChange={(e) => setConfig("npm", e.target.value)}
              >
                <option value="" disabled>Select a provider package…</option>
                {AISDK_PROVIDER_PACKAGES.map((p) => (
                  <option key={p.npm} value={p.npm}>{p.label} — {p.npm}</option>
                ))}
                {v.config?.npm && !isAiSdkPackage(v.config.npm) && (
                  <option value={v.config.npm}>{v.config.npm} (custom)</option>
                )}
              </select>
            </Field>
          </section>
        )}

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

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
          <button className={btnGhost} onClick={props.onCancel} disabled={props.submitting}>Cancel</button>
          <button
            className={btnPrimary}
            onClick={() => props.onSubmit(v)}
            disabled={props.submitting || (requiresKey && !v.apiKeySecretId)}
          >
            {props.submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SecretBindingField(props: {
  orgId: string;
  secrets: OrgSecretMeta[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => createOrgSecret(props.orgId, name.trim(), secretValue),
    onSuccess: async (rec) => {
      await qc.invalidateQueries({ queryKey: ["org-secrets", props.orgId] });
      props.onChange(rec.id);
      setCreating(false);
      setName(""); setSecretValue(""); setErr(null);
    },
    onError: (e: any) => setErr(e?.message ?? "Failed to create secret"),
  });

  return (
    <Field label="Org secret">
      {!creating ? (
        <div className="flex gap-2">
          <select
            className={inputCls}
            value={props.value ?? ""}
            onChange={(e) => props.onChange(e.target.value || undefined)}
          >
            <option value="">Select a secret…</option>
            {props.secrets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" className={btnGhost} onClick={() => setCreating(true)}>
            + Create new
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-slate-700 p-3">
          <input
            className={`${inputCls} font-mono text-sm`}
            placeholder="SECRET_NAME"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="secret value"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => { setCreating(false); setErr(null); }}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!name.trim() || !secretValue || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Saving…" : "Create & select"}
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}

function Field({ label, info, children }: { label: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="mb-1 flex items-center gap-1">
        {label}
        {info ? <InfoButton>{info}</InfoButton> : null}
      </span>
      {children}
    </label>
  );
}

function InfoButton({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="More info"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-semibold leading-none text-slate-300 hover:bg-slate-700"
      >
        i
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setOpen(false); }} />
          <div className="absolute left-0 top-6 z-20 w-80 space-y-2 rounded-md border border-slate-700 bg-slate-900 p-3 text-xs font-normal leading-relaxed text-slate-300 shadow-xl">
            {children}
          </div>
        </>
      )}
    </span>
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
