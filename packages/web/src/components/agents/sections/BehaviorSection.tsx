import type { Agent, AgentUpdateInput, AgentLogLevel } from "@journeyman/core";
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel, InfoIcon } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

const numOrUndef = (v: string) => (v ? Number(v) : undefined);

export function BehaviorSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Behavior" description="Max steps stops runaway loops, Timeout caps wall-clock time. Output mode controls what gets stored after each run. Safety limits here override org defaults for this agent only.">
      <div>
        <FieldLabel help="Maximum reasoning steps the agent takes per run">Max steps</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.maxTurns ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, maxTurns: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel help="Run is killed after this many seconds; leave blank for no limit">Timeout (seconds)</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.timeoutSeconds ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, timeoutSeconds: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel help="How the agent's result is stored after a run">Output mode</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.outputMode}
          onChange={(e) => patch({ outputMode: e.target.value as Agent["outputMode"] })}
        >
          <option value="text">Text</option>
          <option value="structured">Structured</option>
          <option value="none">None</option>
        </select>
      </div>
      <div>
        <FieldLabel help="How much of the agent transcript is streamed to run logs">Log level</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.agentLogLevel ?? "medium"}
          onChange={(e) => patch({ agentLogLevel: e.target.value as AgentLogLevel })}
        >
          <option value="none">None — no agent SDK logs</option>
          <option value="light">Light — only final result line</option>
          <option value="medium">Medium — result + tool calls</option>
          <option value="all">All — full transcript</option>
        </select>
      </div>

      <div className="pt-4 border-t">
        <p className="text-sm font-medium">Safety limits (override org defaults)</p>
        <p className="text-xs text-muted-foreground mb-3">
          Leave blank to inherit the org default. Empty everywhere = no limit.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Max concurrent runs <InfoIcon text="Max simultaneous runs of this agent at once" /></span>
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.maxConcurrentRuns ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, maxConcurrentRuns: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Daily run cap <InfoIcon text="Hard limit on runs per calendar day" /></span>
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.dailyRunCap ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, dailyRunCap: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Budget: max tokens / day <InfoIcon text="Total input + output tokens allowed per day" /></span>
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.budget?.maxTokens ?? ""}
              onChange={(e) =>
                patch({ limits: { ...a.limits, budget: { ...a.limits?.budget, maxTokens: numOrUndef(e.target.value) } } })
              }
            />
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Budget: max $ / day <InfoIcon text="Spend cap in USD per calendar day" /></span>
            <input
              type="number"
              step="0.01"
              className={inputCls}
              disabled={locked}
              value={a.limits?.budget?.maxCostUsd ?? ""}
              onChange={(e) =>
                patch({ limits: { ...a.limits, budget: { ...a.limits?.budget, maxCostUsd: numOrUndef(e.target.value) } } })
              }
            />
          </label>
        </div>
      </div>
    </SectionShell>
  );
}
