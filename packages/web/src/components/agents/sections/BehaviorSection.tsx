import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

const numOrUndef = (v: string) => (v ? Number(v) : undefined);

export function BehaviorSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Behavior" description="Execution limits, output mode, and safety overrides.">
      <div>
        <FieldLabel>Max steps</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.maxTurns ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, maxTurns: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel>Timeout (seconds)</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.timeoutSeconds ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, timeoutSeconds: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel>Output mode</FieldLabel>
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

      <div className="pt-4 border-t">
        <p className="text-sm font-medium">Safety limits (override org defaults)</p>
        <p className="text-xs text-muted-foreground mb-3">
          Leave blank to inherit the org default. Empty everywhere = no limit.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">
            Max concurrent runs
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.maxConcurrentRuns ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, maxConcurrentRuns: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Daily run cap
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.dailyRunCap ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, dailyRunCap: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Budget: max tokens / day
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
            Budget: max $ / day
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
