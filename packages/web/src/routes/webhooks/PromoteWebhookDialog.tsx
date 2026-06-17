import { useEffect, useMemo, useState } from "react";
import type { Webhook, WebhookAuthConfig } from "@journeyman/core";
import { fetchVisibleSecrets, promoteSecretToOrg, type VisibleSecret } from "../../api/secrets.ts";
import { promoteWebhookToOrg } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  orgId: string;
  onClose: () => void;
  onPromoted: (newWebhook: Webhook) => void;
}

function refOf(auth: WebhookAuthConfig): string | null {
  switch (auth.mode) {
    case "none": return null;
    case "header-equals": return auth.valueRef || null;
    case "hmac": return auth.secretRef || null;
    case "jwt": return auth.signingKeyRef || null;
  }
}

type Stage = "loading" | "ready" | "missing" | "not-found" | "promoting-secret" | "promoting-webhook" | "done" | "error";

export function PromoteWebhookDialog({ webhook, orgId, onClose, onPromoted }: Props) {
  const secretRef = useMemo(() => refOf(webhook.auth), [webhook.auth]);
  const needsSecret = secretRef !== null;

  const [stage, setStage] = useState<Stage>("loading");
  const [visible, setVisible] = useState<VisibleSecret[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newWebhook, setNewWebhook] = useState<Webhook | null>(null);
  const [copied, setCopied] = useState(false);

  async function refreshVisibility() {
    const rows = await fetchVisibleSecrets(orgId);
    setVisible(rows);
    if (!needsSecret) {
      setStage("ready");
      return;
    }
    const inOrgOrGlobal = rows.some(
      (s) => s.name === secretRef && (s.scope === "org" || s.scope === "global"),
    );
    if (inOrgOrGlobal) {
      setStage("ready");
      return;
    }
    const inUserScope = rows.some(
      (s) => s.name === secretRef && s.scope === "user",
    );
    setStage(inUserScope ? "missing" : "not-found");
  }

  useEffect(() => {
    void refreshVisibility().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, webhook.id]);

  async function promoteSecret() {
    if (!secretRef) return;
    setStage("promoting-secret");
    setError(null);
    try {
      await promoteSecretToOrg(orgId, secretRef);
      await refreshVisibility();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/409/.test(msg)) {
        await refreshVisibility();
      } else if (/403/.test(msg)) {
        setError("Org admin permission required to promote the secret.");
        setStage("missing");
      } else {
        setError(msg);
        setStage("missing");
      }
    }
  }

  async function promoteWebhook() {
    setStage("promoting-webhook");
    setError(null);
    try {
      const created = await promoteWebhookToOrg(orgId, webhook.id);
      setNewWebhook(created);
      setStage("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/400/.test(msg)) {
        setError("Server rejected the promote — the referenced secret is still missing in org scope.");
        await refreshVisibility();
      } else if (/403/.test(msg)) {
        setError("Org admin permission required.");
        setStage("ready");
      } else {
        setError(msg);
        setStage("ready");
      }
    }
  }

  function copyUrl() {
    if (!newWebhook) return;
    void navigator.clipboard.writeText(newWebhook.ingestUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  function finish() {
    if (newWebhook) onPromoted(newWebhook);
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded border border-slate-700 bg-slate-900 p-6 max-w-lg w-full mx-4 space-y-4"
      >
        <h2 className="text-lg font-medium text-slate-100">
          Promote webhook "{webhook.name}" to org
        </h2>

        <dl className="text-sm space-y-1">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24">Preset</dt>
            <dd className="text-slate-200">{webhook.preset} ({webhook.kind})</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24">Auth</dt>
            <dd className="text-slate-200">{webhook.auth.mode}</dd>
          </div>
          {needsSecret && (
            <div className="flex gap-2">
              <dt className="text-slate-500 w-24">Secret name</dt>
              <dd className="text-slate-200 font-mono">{secretRef}</dd>
            </div>
          )}
        </dl>

        {stage === "loading" && (
          <p className="text-sm text-slate-400">Checking secret visibility…</p>
        )}

        {stage === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-success">
              {needsSecret
                ? `✓ "${secretRef}" exists in org scope.`
                : `✓ This webhook needs no secret.`}
              {" "}A new ingest URL will be generated.
            </p>
            <div className="flex gap-2">
              <button
                onClick={promoteWebhook}
                className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
              >
                Promote webhook
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === "missing" && (
          <div className="space-y-3">
            <p className="text-sm text-warning">
              ⚠ "{secretRef}" is in your personal vault but not in org scope. The
              org-scope webhook can't read personal secrets at ingest time.
            </p>
            <div className="flex gap-2">
              <button
                onClick={promoteSecret}
                className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
              >
                Promote secret first
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === "not-found" && (
          <div className="space-y-3">
            <p className="text-sm text-danger">
              ⚠ "{secretRef}" doesn't exist in any vault yet. The webhook references a
              secret name that hasn't been created.
            </p>
            <p className="text-xs text-slate-400">
              Go to <a href="/me/secrets" className="underline text-success">My Secrets</a> (or
              <a href="/admin/secrets" className="underline text-success"> Org Secrets</a>) and
              create a secret named <code className="font-mono">{secretRef}</code> with the value
              you pasted into the provider's webhook configuration. Then re-open this dialog.
            </p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
            >
              Close
            </button>
          </div>
        )}

        {stage === "promoting-secret" && (
          <p className="text-sm text-slate-300">Promoting secret to org scope…</p>
        )}

        {stage === "promoting-webhook" && (
          <p className="text-sm text-slate-300">Promoting webhook…</p>
        )}

        {stage === "done" && newWebhook && (
          <div className="space-y-3">
            <p className="text-sm text-success">✓ Webhook promoted.</p>
            <label className="block">
              <span className="block text-xs text-slate-400 mb-1">
                New ingest URL — copy now into the provider's webhook settings
              </span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={newWebhook.ingestUrl}
                  className="flex-1 rounded bg-bg border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
                />
                <button
                  onClick={copyUrl}
                  className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </label>
            <p className="text-[11px] text-slate-500">
              Your personal webhook is still active. Delete it from My Webhooks if no
              longer needed.
            </p>
            <button
              onClick={finish}
              className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
            >
              Done
            </button>
          </div>
        )}

        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}

        {visible.length === 0 && stage !== "loading" && (
          <p className="text-[11px] text-slate-600">
            (No org/user secrets found via /_visible-names — check that the secrets API is reachable.)
          </p>
        )}
      </div>
    </div>
  );
}
