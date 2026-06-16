import { useEffect, useMemo, useState } from "react";
import type { WebhookAuthConfig } from "@journeyman/core";
import {
  fetchVisibleSecrets,
  filterSecrets,
  promoteSecretToOrg,
  type VisibleSecret,
} from "../../api/secrets.ts";
import { GenerateSecretPanel } from "./GenerateSecretPanel.tsx";

export interface SecretPickerProps {
  authMode: WebhookAuthConfig["mode"];
  presetId: string;
  scope: "org" | "user";
  orgId: string;
  isAdmin: boolean;
  value: string;
  onChange: (name: string) => void;
}

type Panel = "closed" | "generate" | "type";

type SecretScopeLocal = VisibleSecret["scope"];

export function SecretPicker(props: SecretPickerProps) {
  const { authMode, presetId, scope, orgId, isAdmin, value, onChange } = props;

  const [secrets, setSecrets] = useState<VisibleSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>("closed");
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchVisibleSecrets(orgId).then((rows) => {
      if (cancelled) return;
      setSecrets(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const orgVisible = useMemo(
    () => filterSecrets(secrets, "org-and-global"),
    [secrets],
  );
  const userVisible = useMemo(
    () => secrets.filter((s) => s.scope === "user"),
    [secrets],
  );

  const showPromoteGroup = scope === "org" && isAdmin && userVisible.length > 0;
  const canGenerate = authMode === "hmac" || authMode === "header-equals";

  async function promote(name: string) {
    setPromoteError(null);
    setPromoting(name);
    try {
      await promoteSecretToOrg(orgId, name);
      setSecrets((prev) => {
        if (prev.some((s) => s.scope === "org" && s.name === name)) return prev;
        return [...prev, { name, scope: "org" }];
      });
      onChange(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409/.test(msg)) {
        setPromoteError(`Org-scope secret "${name}" already exists — pick it from the org section.`);
      } else if (/403/.test(msg)) {
        setPromoteError("Org admin permission required.");
      } else {
        setPromoteError(msg);
      }
    } finally {
      setPromoting(null);
    }
  }

  function refreshAfterGenerate(savedName: string) {
    setSecrets((prev) => {
      const newScope: SecretScopeLocal = scope === "org" ? "org" : "user";
      if (prev.some((s) => s.scope === newScope && s.name === savedName)) return prev;
      return [...prev, { name: savedName, scope: newScope }];
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
              {scope === "org" ? (
                <optgroup label="Org secrets">
                  {orgVisible.map((s) => (
                    <option key={`org:${s.name}`} value={s.name}>
                      {s.name} ({s.scope})
                    </option>
                  ))}
                </optgroup>
              ) : (
                <>
                  {orgVisible.length > 0 && (
                    <optgroup label="Org / global">
                      {orgVisible.map((s) => (
                        <option key={`org:${s.name}`} value={s.name}>
                          {s.name} ({s.scope})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {userVisible.length > 0 && (
                    <optgroup label="Mine">
                      {userVisible.map((s) => (
                        <option key={`user:${s.name}`} value={s.name}>
                          {s.name} (mine)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
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

      {showPromoteGroup && (
        <div className="rounded border border-slate-700 p-3 text-xs space-y-2">
          <div className="text-slate-400">
            Your personal secrets — promote one to use it on this org webhook:
          </div>
          <ul className="space-y-1">
            {userVisible.map((s) => (
              <li key={`promote:${s.name}`} className="flex items-center justify-between">
                <span className="font-mono text-slate-200">{s.name}</span>
                <button
                  type="button"
                  onClick={() => promote(s.name)}
                  disabled={promoting === s.name}
                  className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px] disabled:opacity-50"
                >
                  {promoting === s.name ? "Promoting…" : "Promote →"}
                </button>
              </li>
            ))}
          </ul>
          {promoteError && <p className="text-danger">{promoteError}</p>}
        </div>
      )}

      {panel === "generate" && (
        <GenerateSecretPanel
          presetId={presetId}
          scope={scope}
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
          secret (My Secrets / Org Secrets) first, then pick it here.
        </p>
      )}
    </div>
  );
}
