import { useEffect, useState } from "react";
import type { AgentInputField } from "@journeyman/core";
import { agentsApi, type ApiToken } from "../../../api/agents.ts";

interface ApiTriggerProps {
  agentId: string;
  wsId: string;
  inputs: AgentInputField[];
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString();
}

export function ApiTrigger({ agentId, wsId, inputs }: ApiTriggerProps) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [revealedToken, setRevealedToken] = useState<{ id: string; plaintext: string } | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [showCurl, setShowCurl] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  const endpoint = `/api/agents/${agentId}/fire`;
  const endpointFull = `${window.location.origin}${endpoint}`;

  const reload = () => agentsApi.listApiTokens(wsId, agentId).then(setTokens).catch(() => setTokens([]));
  useEffect(() => { void reload(); }, [wsId, agentId]);

  const issue = async () => {
    const r = await agentsApi.issueApiToken(wsId, agentId);
    setRevealedToken({ id: r.id, plaintext: r.token });
    await reload();
  };

  const curlBody =
    inputs.length > 0
      ? JSON.stringify(
          Object.fromEntries(
            inputs.map((inp) => [
              inp.name,
              inp.type === "number" ? 42 : inp.type === "boolean" ? true : `<${inp.name}>`,
            ]),
          ),
          null,
          2,
        )
      : null;

  const curlText = [
    `curl -X POST "${endpointFull}" \\`,
    `  -H "Authorization: Bearer <your-token>" \\`,
    `  -H "Content-Type: application/json"`,
    ...(curlBody ? [`  -d '${curlBody}'`] : []),
  ].join(" \\\n");

  const handleCopyCurl = () => {
    copyToClipboard(curlText);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Endpoint row */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Endpoint</div>
        <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 font-mono text-xs">
          <span className="bg-foreground text-background text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">
            POST
          </span>
          <span className="flex-1 text-foreground truncate">{endpoint}</span>
          <button
            type="button"
            onClick={() => copyToClipboard(endpointFull)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Copy URL"
          >
            ⎘
          </button>
        </div>
      </div>

      {/* One-time reveal banner */}
      {revealedToken && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 space-y-2">
          <p className="text-xs font-medium text-emerald-400">✓ Token issued — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-2 font-mono text-xs break-all">
            <span className="flex-1 text-foreground">{revealedToken.plaintext}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(revealedToken!.plaintext)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              ⎘
            </button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setRevealedToken(null)}
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Tokens */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Tokens</div>
        <div className="space-y-1.5 mb-3">
          {tokens.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tokens yet.</p>
          )}
          {tokens.map((tok) => {
            const isRevoked = tok.revoked_at !== null;
            const isDisabled = !isRevoked && tok.disabled_at !== null;
            return (
              <div
                key={tok.id}
                className={`flex items-center gap-3 bg-muted border border-border rounded-lg px-3 py-2.5 ${
                  isRevoked || isDisabled ? "opacity-55" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{tok.name || tok.id.slice(0, 8)}</span>
                    {isRevoked ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        Revoked
                      </span>
                    ) : isDisabled ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        Disabled
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    jm_agt_{tok.id.slice(0, 4)}••••••••••••
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Created {formatDate(tok.created_at)} · Last used {formatDate(tok.last_used_at)}
                  </div>
                </div>
                {!isRevoked && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    {isDisabled ? (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                        onClick={() => agentsApi.enableApiToken(wsId, agentId, tok.id).then(reload)}
                      >
                        Enable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                        onClick={() => agentsApi.disableApiToken(wsId, agentId, tok.id).then(reload)}
                      >
                        Disable
                      </button>
                    )}
                    {revokeConfirm === tok.id ? (
                      <>
                        <button
                          type="button"
                          className="text-[11px] border border-destructive/40 rounded px-2 py-1 text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={() =>
                            agentsApi
                              .revokeApiToken(wsId, agentId, tok.id)
                              .then(() => { setRevokeConfirm(null); return reload(); })
                          }
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground"
                          onClick={() => setRevokeConfirm(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-destructive"
                        onClick={() => setRevokeConfirm(tok.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 w-full py-2 border border-dashed border-ring rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={issue}
        >
          ＋ Issue new token
        </button>
      </div>

      {/* Curl usage example */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          className="flex items-center justify-between w-full px-3.5 py-2.5 bg-muted text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowCurl((v) => !v)}
        >
          <span className="flex items-center gap-2">
            📋 Usage example
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-400">curl</span>
          </span>
          <span className="text-xs">{showCurl ? "▴" : "▾"}</span>
        </button>
        {showCurl && (
          <div className="p-3 bg-background border-t border-border space-y-3">
            {inputs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pass your agent's inputs as JSON. This agent expects:{" "}
                {inputs.map((i, idx) => (
                  <span key={i.name}>
                    <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">{i.name}</code>
                    {idx < inputs.length - 1 ? ", " : ""}
                  </span>
                ))}
                .
              </p>
            )}
            <div className="relative bg-background rounded-lg border border-border p-3">
              <button
                type="button"
                className={`absolute top-2 right-2 text-[11px] border rounded px-2 py-1 transition-colors ${
                  curlCopied
                    ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-400"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-ring"
                }`}
                onClick={handleCopyCurl}
              >
                {curlCopied ? "✓ Copied" : "⎘ Copy"}
              </button>
              <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap break-all pr-16">
                {curlText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
