import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import { rotateWebhook } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
}

export function WebhookOverviewTab({ webhook, onChange }: Props) {
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!confirm("Rotate the URL token? Old URL stops working immediately.")) return;
    setBusy(true);
    try {
      const next = await rotateWebhook(webhook.id);
      onChange(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <Field label="Ingest URL">
        <code className="block px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-xs break-all">
          {webhook.ingestUrl}
        </code>
        <button
          onClick={rotate}
          disabled={busy}
          className="mt-2 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
        >
          {busy ? "Rotating…" : "Rotate URL token"}
        </button>
      </Field>
      <Field label="Preset"><span className="text-slate-300">{webhook.preset} ({webhook.kind})</span></Field>
      <Field label="Auth mode"><code className="text-xs text-slate-300">{webhook.auth.mode}</code></Field>
      <Field label="Event type path"><code className="text-xs text-slate-300">{webhook.eventTypePath ?? "—"}</code></Field>
      <Field label="Created"><span className="text-slate-400">{new Date(webhook.createdAt).toLocaleString()}</span></Field>
      <Field label="Last event">
        <span className="text-slate-400">
          {webhook.lastEventAt ? new Date(webhook.lastEventAt).toLocaleString() : "never"}
        </span>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
