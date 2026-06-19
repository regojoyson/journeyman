import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnGhost, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

/** Drop empty-string values from a name→value record. */
function pruneEmpty(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) if (v.trim()) out[k] = v.trim();
  return out;
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  const schedule = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
    | undefined;
  const webhook = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; inputsMapping?: Record<string, string> }
    | undefined;

  const setSchedule = (next: { cron: string; timezone: string; fixedInputs: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    patch({ triggers: next ? [...others, { type: "schedule", ...next }] : others });
  };
  const setWebhook = (next: { webhookId: string; inputsMapping: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    patch({ triggers: next ? [...others, { type: "webhook", ...next }] : others });
  };

  const webhookPaths = (webhook?.inputsMapping ?? {}) as Record<string, string>;
  const scheduleValues = (schedule?.fixedInputs ?? {}) as Record<string, string>;

  // API tokens (immediate, independent of Save)
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; created_at: string }>>([]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  useEffect(() => {
    agentsApi.listApiTokens(wsId, a.id).then(setApiTokens).catch(() => setApiTokens([]));
  }, [wsId, a.id]);
  const issueToken = async () => {
    const r = await agentsApi.issueApiToken(wsId, a.id);
    setRevealedToken(r.token);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };
  const revokeToken = async (tokenId: string) => {
    await agentsApi.revokeApiToken(wsId, a.id, tokenId);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };

  const noInputs = a.inputs.length === 0;

  return (
    <SectionShell title="Triggers" description="How runs are started — on a schedule, via the API, or from a webhook.">
      {/* Schedule */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">⏱ Schedule</div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(schedule)}
            onChange={(e) =>
              setSchedule(e.target.checked ? { cron: "0 2 * * *", timezone: "UTC", fixedInputs: scheduleValues } : null)
            }
          />{" "}
          Run on a schedule
        </label>
        {schedule && (
          <>
            <div className="flex gap-2">
              <input
                className={inputCls}
                disabled={locked}
                placeholder="cron (e.g. 0 2 * * *)"
                value={schedule.cron}
                onChange={(e) =>
                  setSchedule({ cron: e.target.value, timezone: schedule.timezone, fixedInputs: scheduleValues })
                }
              />
              <input
                className={inputCls}
                disabled={locked}
                placeholder="IANA timezone"
                value={schedule.timezone}
                onChange={(e) =>
                  setSchedule({ cron: schedule.cron, timezone: e.target.value, fixedInputs: scheduleValues })
                }
              />
            </div>
            {noInputs ? (
              <div className="text-xs text-muted-foreground">Add {"{{inputs}}"} to the prompt to set values here.</div>
            ) : (
              a.inputs.map((inp) => (
                <div key={inp.name} className="flex items-center gap-2">
                  <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                  <span className="text-muted-foreground">=</span>
                  <input
                    className={inputCls}
                    disabled={locked}
                    placeholder="fixed value"
                    value={scheduleValues[inp.name] ?? ""}
                    onChange={(e) =>
                      setSchedule({
                        cron: schedule.cron,
                        timezone: schedule.timezone,
                        fixedInputs: pruneEmpty({ ...scheduleValues, [inp.name]: e.target.value }),
                      })
                    }
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* API */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">&lt;/&gt; API</div>
        <div className="text-xs text-muted-foreground">
          Fire via <code className={codePill}>POST /api/agents/{a.id}/fire</code> with{" "}
          <code className={codePill}>Authorization: Bearer &lt;token&gt;</code>.
        </div>
        {revealedToken && (
          <div className="text-xs bg-muted rounded p-2 break-all">
            🔑 Copy now (shown once): <code className={codePill}>{revealedToken}</code>
          </div>
        )}
        <button className={btnGhost} onClick={issueToken}>Issue token</button>
        <ul className="text-xs text-muted-foreground space-y-1">
          {apiTokens.map((t) => (
            <li key={t.id} className="flex gap-2 items-center">
              <span>token …{t.id.slice(0, 8)} · created {t.created_at}</span>
              <button className="text-destructive underline" onClick={() => revokeToken(t.id)}>revoke</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Webhook */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">🪝 Webhook</div>
        <div className="text-xs text-muted-foreground">
          Create a webhook on the Webhooks page, then paste its ID here. Inbound events fire this agent.
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(webhook)}
            onChange={(e) => setWebhook(e.target.checked ? { webhookId: "", inputsMapping: webhookPaths } : null)}
          />{" "}
          Fire from a webhook
        </label>
        {webhook && (
          <>
            <input
              className={inputCls}
              disabled={locked}
              placeholder="webhook id"
              value={webhook.webhookId}
              onChange={(e) => setWebhook({ webhookId: e.target.value, inputsMapping: webhookPaths })}
            />
            {noInputs ? (
              <div className="text-xs text-muted-foreground">Add {"{{inputs}}"} to the prompt to map them.</div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">Map each input from the payload (a JSON path):</div>
                {a.inputs.map((inp) => (
                  <div key={inp.name} className="flex items-center gap-2">
                    <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                    <span className="text-muted-foreground">←</span>
                    <input
                      className={inputCls}
                      disabled={locked}
                      placeholder="$.issue.key"
                      value={webhookPaths[inp.name] ?? ""}
                      onChange={(e) =>
                        setWebhook({
                          webhookId: webhook.webhookId,
                          inputsMapping: pruneEmpty({ ...webhookPaths, [inp.name]: e.target.value }),
                        })
                      }
                    />
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </SectionShell>
  );
}
