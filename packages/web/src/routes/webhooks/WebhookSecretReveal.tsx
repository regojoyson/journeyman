import { useState } from "react";
import type { Webhook } from "@journeyman/core";

interface Props {
  webhook: Webhook;
  onDone: () => void;
}

export function WebhookSecretReveal({ webhook, onDone }: Props) {
  const [copied, setCopied] = useState<"url" | null>(null);

  function copy(text: string, which: "url") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-emerald-700/40 bg-emerald-900/10 p-4">
        <h3 className="text-base font-medium text-emerald-200 mb-1">Webhook created</h3>
        <p className="text-sm text-slate-300">
          Copy the URL into the provider's webhook settings. The URL token can be
          rotated later if it leaks.
        </p>
      </div>

      <label className="block">
        <span className="block text-xs text-slate-400 mb-1">Ingest URL</span>
        <div className="flex gap-2">
          <input
            readOnly
            value={webhook.ingestUrl}
            className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => copy(webhook.ingestUrl, "url")}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {copied === "url" ? "Copied!" : "Copy"}
          </button>
        </div>
      </label>

      <p className="text-xs text-slate-500">
        The HMAC / token / JWT secret itself is stored in the secrets vault under
        the name you specified — it isn't shown here.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-100"
      >
        Done
      </button>
    </div>
  );
}
