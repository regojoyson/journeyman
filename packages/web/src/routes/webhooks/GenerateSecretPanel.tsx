import { useState } from "react";
import { createOrgSecret, createUserSecret, secretNameSuggestion } from "../../api/secrets.ts";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function generateHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GenerateSecretPanelProps {
  presetId: string;
  scope: "org" | "user";
  orgId: string;
  onSaved: (name: string) => void;
  onCancel: () => void;
}

export function GenerateSecretPanel({ presetId, scope, orgId, onSaved, onCancel }: GenerateSecretPanelProps) {
  const [name, setName] = useState(secretNameSuggestion(presetId));
  const [generatedValue, setGeneratedValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    setError(null);

    if (!NAME_RE.test(name)) {
      setError("Names must be UPPER_SNAKE_CASE (e.g. GITHUB_WEBHOOK_SECRET).");
      return;
    }

    const value = generateHex(32);
    setBusy(true);
    try {
      if (scope === "org") {
        await createOrgSecret(orgId, name, value, `Webhook secret for preset ${presetId}`);
      } else {
        await createUserSecret(orgId, name, value, `Webhook secret for preset ${presetId}`);
      }
      setGeneratedValue(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409/.test(msg) || /already/i.test(msg)) {
        setError(`"${name}" is already in use — pick a different name or close this and select it from the dropdown.`);
      } else if (/403/.test(msg)) {
        setError("You don't have permission to create a secret in this scope.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!generatedValue) return;
    void navigator.clipboard.writeText(generatedValue).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  if (generatedValue) {
    return (
      <div className="mt-2 rounded border border-emerald-700/40 bg-success/10 p-3 space-y-2">
        <div className="text-xs font-medium text-success">
          Generated value — copy now, won't be shown again
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={generatedValue}
            className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={copy}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="text-[11px] text-slate-400">
          Saved as <code>{name}</code>. Paste this exact value into the provider's webhook
          secret field.
        </div>
        <button
          type="button"
          onClick={() => onSaved(name)}
          className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
        >
          Done — I've copied it
        </button>
      </div>
    );
  }

  return (
    // NOT a <form>: this panel is rendered inside other <form>s (e.g. the webhook
    // create wizard). Nested forms are invalid HTML and break submit association,
    // crashing the page. Use a div + button onClick; Enter on the name input saves.
    <div className="mt-2 rounded border border-slate-700 p-3 space-y-2">
      <div className="text-xs font-medium text-slate-200">New secret</div>
      <label className="block">
        <span className="block text-[11px] text-slate-400 mb-1">Name (UPPER_SNAKE_CASE)</span>
        <input
          className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }}
          placeholder="GITHUB_WEBHOOK_SECRET"
        />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & generate"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-100"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Journeyman will generate a 256-bit hex value, store it under this name, and show
        it once so you can paste it into the provider.
      </p>
    </div>
  );
}
