import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";
import { getPresetDetail, testWebhook, type TestDeliveryResult } from "../../api/webhooks.ts";
import { skeletonFromSchema } from "./schema-skeleton.ts";

export function WebhookTestPanel({ webhook }: { webhook: Webhook }) {
  const [samples, setSamples] = useState<Record<string, unknown>>({});
  const [schema, setSchema] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>("");
  const [customPayload, setCustomPayload] = useState<string>("");
  const [result, setResult] = useState<TestDeliveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPresetDetail(webhook.preset)
      .then((d) => {
        const s = (d.samples ?? {}) as Record<string, unknown>;
        setSamples(s);
        setSchema(d.payloadSchema ?? null);
        const keys = Object.keys(s);
        if (keys.length > 0) setSelected(keys[0]!);
      })
      .catch(() => { /* preset may not exist (generic); leave empty */ });
  }, [webhook.preset]);

  function loadSampleIntoTextarea() {
    if (!selected) return;
    const sample = samples[selected];
    if (sample === undefined) return;
    setCustomPayload(JSON.stringify(sample, null, 2));
  }

  function loadSchemaSkeletonIntoTextarea() {
    if (!schema) return;
    const skeleton = skeletonFromSchema(schema);
    setCustomPayload(JSON.stringify(skeleton, null, 2));
  }

  async function send() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      let body: { sampleEvent?: string; payload?: unknown };
      if (customPayload.trim()) {
        try { body = { payload: JSON.parse(customPayload) }; }
        catch (e) { throw new Error(`Custom payload not JSON: ${e instanceof Error ? e.message : String(e)}`); }
      } else if (selected) {
        body = { sampleEvent: selected };
      } else {
        throw new Error("Pick a sample or paste a custom payload");
      }
      setResult(await testWebhook(webhook.id, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sampleKeys = Object.keys(samples);
  const hasSchema = schema != null;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-400">
        Sends a synthetic, validly-signed event through this webhook's ingest pipeline. JWT auth is not synthesized in v1.
      </p>
      {sampleKeys.length > 0 && (
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Sample event from preset</span>
          <select
            className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sampleKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        {sampleKeys.length > 0 && (
          <button
            type="button"
            onClick={loadSampleIntoTextarea}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs"
          >
            Load sample
          </button>
        )}
        {hasSchema && (
          <button
            type="button"
            onClick={loadSchemaSkeletonIntoTextarea}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs"
          >
            Generate from schema
          </button>
        )}
      </div>
      <label className="block">
        <span className="block text-xs text-slate-400 mb-1">Or paste a custom payload (overrides sample)</span>
        <textarea
          rows={6}
          className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          value={customPayload}
          onChange={(e) => setCustomPayload(e.target.value)}
          placeholder='{"action":"opened"}'
        />
      </label>
      <button
        onClick={send}
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send test event"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <pre className="text-xs rounded bg-slate-900 border border-slate-700 p-2 overflow-x-auto">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
