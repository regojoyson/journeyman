import { useMemo, useState } from "react";
import type { Webhook, WebhookAuthConfig } from "@journeyman/core";
import { rotateWebhook, updateWebhook } from "../../api/webhooks.ts";
import { SecretPicker } from "./SecretPicker.tsx";
import { useAuth } from "../../AuthContext.tsx";

interface Props {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
}

export function WebhookOverviewTab({ webhook, onChange }: Props) {
  const [busy, setBusy] = useState(false);

  const { activeOrgId } = useAuth();
  const needsSecret = webhook.auth.mode !== "none";
  const currentRef = useMemo(() => refOf(webhook.auth), [webhook.auth]);

  const [editingSecret, setEditingSecret] = useState(false);
  const [secretDraft, setSecretDraft] = useState(currentRef);
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);

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

  function startEditSecret() {
    setSecretDraft(currentRef);
    setSecretError(null);
    setEditingSecret(true);
  }

  function cancelEditSecret() {
    setSecretDraft(currentRef);
    setSecretError(null);
    setEditingSecret(false);
  }

  async function saveSecret() {
    if (!secretDraft.trim()) {
      setSecretError("Secret reference is required for this auth mode");
      return;
    }
    if (secretDraft === currentRef) {
      setEditingSecret(false);
      return;
    }
    setSecretBusy(true);
    setSecretError(null);
    try {
      const updated = await updateWebhook(webhook.id, { auth: withRef(webhook.auth, secretDraft) });
      onChange(updated);
      setEditingSecret(false);
    } catch (e) {
      setSecretError(e instanceof Error ? e.message : String(e));
    } finally {
      setSecretBusy(false);
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
      {needsSecret && (
        <Field label="Secret reference">
          {editingSecret ? (
            <div className="space-y-2">
              {activeOrgId ? (
                <SecretPicker
                  authMode={webhook.auth.mode}
                  presetId={webhook.preset}
                  orgId={activeOrgId}
                  value={secretDraft}
                  onChange={setSecretDraft}
                />
              ) : (
                <p className="text-xs text-danger">No active org context.</p>
              )}
              {secretError && <p className="text-xs text-danger">{secretError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => void saveSecret()}
                  disabled={secretBusy}
                  className="text-xs px-2 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50"
                >
                  {secretBusy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEditSecret}
                  disabled={secretBusy}
                  className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <code className="text-xs text-slate-300">{currentRef || "(unset)"}</code>
              <button
                onClick={startEditSecret}
                className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
              >
                Edit
              </button>
            </div>
          )}
        </Field>
      )}
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

function refOf(auth: WebhookAuthConfig): string {
  switch (auth.mode) {
    case "none": return "";
    case "header-equals": return auth.valueRef;
    case "hmac": return auth.secretRef;
    case "jwt": return auth.signingKeyRef ?? "";
  }
}

function withRef(auth: WebhookAuthConfig, ref: string): WebhookAuthConfig {
  switch (auth.mode) {
    case "none": return auth;
    case "header-equals": return { ...auth, valueRef: ref };
    case "hmac": return { ...auth, secretRef: ref };
    case "jwt": return { ...auth, signingKeyRef: ref };
  }
}
