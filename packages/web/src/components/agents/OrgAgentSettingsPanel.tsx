import { useEffect, useState } from "react";
import type { OrgAgentSettings } from "@journeyman/core";
import { agentsApi } from "../../api/agents.ts";

const inputCls = "border rounded px-2 py-1 w-full bg-background text-sm";

/** Org-level kill-switch (pause all agents) + default safety limits (§15.1). */
export function OrgAgentSettingsPanel({ orgId }: { orgId: string }) {
  const [s, setS] = useState<OrgAgentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agentsApi.getSettings(orgId).then(setS).catch((e) => setError(e?.message ?? String(e)));
  }, [orgId]);

  if (!s) return <div className="text-sm text-muted-foreground">{error ?? "Loading settings…"}</div>;

  const save = async (next: OrgAgentSettings) => {
    setBusy(true);
    setError(null);
    try {
      setS(await agentsApi.updateSettings(orgId, { paused: next.paused, limits: next.limits }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const limit = (patch: Partial<OrgAgentSettings["limits"]>) => setS({ ...s, limits: { ...s.limits, ...patch } });
  const budget = (patch: Partial<NonNullable<OrgAgentSettings["limits"]["budget"]>>) =>
    setS({ ...s, limits: { ...s.limits, budget: { ...s.limits.budget, ...patch } } });

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">Agent safety</h2>
          <p className="text-xs text-muted-foreground">Org-wide kill-switch and default limits. Per-agent settings override these.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={s.paused} onChange={(e) => save({ ...s, paused: e.target.checked })} disabled={busy} />
          Pause all agents
        </label>
      </div>

      {s.paused && (
        <p className="text-xs text-amber-600">⏸ All agents paused — new runs are skipped; in-flight runs finish.</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground">
          Default max concurrent runs
          <input
            type="number"
            className={inputCls}
            value={s.limits.maxConcurrentRuns ?? ""}
            onChange={(e) => limit({ maxConcurrentRuns: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Default daily run cap
          <input
            type="number"
            className={inputCls}
            value={s.limits.dailyRunCap ?? ""}
            onChange={(e) => limit({ dailyRunCap: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Default budget: max tokens / day
          <input
            type="number"
            className={inputCls}
            value={s.limits.budget?.maxTokens ?? ""}
            onChange={(e) => budget({ maxTokens: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Default budget: max $ / day
          <input
            type="number"
            step="0.01"
            className={inputCls}
            value={s.limits.budget?.maxCostUsd ?? ""}
            onChange={(e) => budget({ maxCostUsd: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        disabled={busy}
        onClick={() => save(s)}
      >
        Save limits
      </button>
    </section>
  );
}
