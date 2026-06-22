import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { WebhookAuthConfig } from "@journeyman/core";
import {
  fetchVisibleSecrets,
  type VisibleSecret,
} from "../../api/secrets.ts";
import { GenerateSecretPanel } from "./GenerateSecretPanel.tsx";

export interface SecretPickerProps {
  authMode: WebhookAuthConfig["mode"];
  presetId: string;
  orgId: string;
  value: string;
  onChange: (name: string) => void;
}

type Panel = "closed" | "generate" | "type";

export function SecretPicker(props: SecretPickerProps) {
  const { authMode, presetId, orgId, value, onChange } = props;
  // Visible secrets are workspace-scoped; webhooks always render under /workspaces/:wsId.
  // orgId is still used below to create an org-scoped secret via the generate panel.
  const { wsId = "" } = useParams<{ wsId: string }>();

  const [secrets, setSecrets] = useState<VisibleSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>("closed");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchVisibleSecrets(wsId).then((rows) => {
      if (cancelled) return;
      setSecrets(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [wsId]);

  const canGenerate = authMode === "hmac" || authMode === "header-equals";

  function refreshAfterGenerate(savedName: string) {
    setSecrets((prev) => {
      if (prev.some((s) => s.scope === "org" && s.name === savedName)) return prev;
      return [...prev, { name: savedName, scope: "org" }];
    });
    onChange(savedName);
    setPanel("closed");
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-slate-400 mb-1">Secret</span>
        <div className="flex gap-2 items-center">
          {panel === "type" ? (
            <input
              autoFocus
              className="flex-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
              value={value}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              placeholder="GITHUB_WEBHOOK_SECRET"
            />
          ) : (
            <select
              className="flex-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-sm text-slate-100"
              value={value}
              disabled={loading}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__type__") {
                  setPanel("type");
                  onChange("");
                } else {
                  setPanel("closed");
                  onChange(v);
                }
              }}
            >
              <option value="">{loading ? "Loading secrets…" : "— pick a secret —"}</option>
              <optgroup label="Org secrets">
                {secrets.map((s) => (
                  <option key={`org:${s.name}`} value={s.name}>
                    {s.name} ({s.scope})
                  </option>
                ))}
              </optgroup>
              <option value="__type__">✏  type a name…</option>
            </select>
          )}
          {canGenerate && panel !== "generate" && (
            <button
              type="button"
              onClick={() => setPanel("generate")}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm whitespace-nowrap"
            >
              + Generate new
            </button>
          )}
          {panel === "type" && (
            <button
              type="button"
              onClick={() => setPanel("closed")}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs"
            >
              ← back to picker
            </button>
          )}
        </div>
      </label>

      {panel === "generate" && (
        <GenerateSecretPanel
          presetId={presetId}
          orgId={orgId}
          onSaved={refreshAfterGenerate}
          onCancel={() => setPanel("closed")}
        />
      )}

      {panel === "type" && (
        <p className="text-[11px] text-warning/80">
          Make sure a secret with this name exists in your vault before events start arriving.
        </p>
      )}

      {!canGenerate && authMode === "jwt" && (
        <p className="text-[11px] text-slate-500">
          This provider chooses the signing key — paste the value they give you into a
          secret (Org Secrets) first, then pick it here.
        </p>
      )}
    </div>
  );
}
