import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import { updateWebhook } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
}

export function WebhookSchemaTab({ webhook, onChange }: Props) {
  const [text, setText] = useState(
    webhook.payloadSchema ? JSON.stringify(webhook.payloadSchema, null, 2) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let parsed: unknown = null;
    if (text.trim()) {
      try { parsed = JSON.parse(text); }
      catch (e) { setError(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
    }
    setBusy(true);
    try {
      const next = await updateWebhook(webhook.id, { payloadSchema: parsed });
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        JSON Schema (draft-07) for payloads. Used for editor autocomplete and (optionally) ingest validation.
      </p>
      <textarea
        rows={16}
        className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="{}"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        onClick={save}
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save schema"}
      </button>
    </div>
  );
}
