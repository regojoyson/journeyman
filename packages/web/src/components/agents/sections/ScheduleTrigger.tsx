import { useState } from "react";
import type { AgentInputField } from "@journeyman/core";
import { toCron, fromCron, summarizeCron, DEFAULT_SCHEDULE, type ScheduleState } from "../../../lib/cron-builder.ts";
import { inputCls } from "../../../routes/admin-styles.ts";

interface ScheduleTriggerProps {
  cron: string;
  timezone: string;
  fixedInputs: Record<string, string>;
  inputs: AgentInputField[];
  locked: boolean;
  onChange: (cron: string, timezone: string, fixedInputs: Record<string, string>) => void;
}

const TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "America/Honolulu",
  "America/Sao_Paulo", "America/Toronto", "America/Vancouver",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam",
  "Europe/Moscow", "Europe/Istanbul",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Pacific/Auckland",
];

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function ScheduleTrigger({ cron, timezone, fixedInputs, inputs, locked, onChange }: ScheduleTriggerProps) {
  const [state, setState] = useState<ScheduleState>(() => fromCron(cron) ?? DEFAULT_SCHEDULE);
  const [advancedCron, setAdvancedCron] = useState(cron);
  const [showAdvanced, setShowAdvanced] = useState(() => fromCron(cron) === null && cron !== "");
  const [tz, setTz] = useState(() => timezone || detectTimezone());

  const updateState = (next: ScheduleState) => {
    setState(next);
    onChange(toCron(next), tz, fixedInputs);
  };

  const updateTz = (nextTz: string) => {
    setTz(nextTz);
    onChange(showAdvanced ? advancedCron : toCron(state), nextTz, fixedInputs);
  };

  const handleAdvanced = (val: string) => {
    setAdvancedCron(val);
    onChange(val, tz, fixedInputs);
    const parsed = fromCron(val);
    if (parsed) setState(parsed);
  };

  const preview = showAdvanced ? advancedCron : summarizeCron(state, tz);

  return (
    <div className="space-y-4">
      {/* Frequency pills */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Frequency</div>
        <div className="flex gap-2">
          {(["hourly", "daily", "weekly", "monthly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              disabled={locked}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                state.frequency === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-ring"
              }`}
              onClick={() => updateState({ ...state, frequency: f })}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Day-of-week circles (weekly only) */}
      {state.frequency === "weekly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">On</div>
          <div className="flex gap-1.5">
            {DOW_LABELS.map((label, idx) => (
              <button
                key={idx}
                type="button"
                disabled={locked}
                className={`w-9 h-9 rounded-full text-xs border transition-colors ${
                  state.days.includes(idx)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-ring"
                }`}
                onClick={() => {
                  const days = state.days.includes(idx)
                    ? state.days.filter((d) => d !== idx)
                    : [...state.days, idx].sort((a, b) => a - b);
                  updateState({ ...state, days });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day-of-month dropdown (monthly only) */}
      {state.frequency === "monthly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">On the</div>
          <select
            className={`${inputCls} w-40`}
            disabled={locked}
            value={state.dom}
            onChange={(e) => updateState({ ...state, dom: Number(e.target.value) })}
          >
            {Array.from({ length: 27 }, (_, i) => i + 1).map((d) => {
              const suffixes = ["th", "st", "nd", "rd"];
              const v = d % 100;
              const ord = d + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]);
              return <option key={d} value={d}>{ord}</option>;
            })}
            <option value={28}>Last day</option>
          </select>
        </div>
      )}

      {/* Time picker (daily / weekly / monthly) */}
      {state.frequency !== "hourly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">At</div>
          <input
            type="time"
            className={`${inputCls} w-36`}
            disabled={locked}
            value={state.time}
            onChange={(e) => updateState({ ...state, time: e.target.value })}
          />
        </div>
      )}

      {/* Timezone */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Timezone</div>
        <select className={inputCls} disabled={locked} value={tz} onChange={(e) => updateTz(e.target.value)}>
          {!TIMEZONES.includes(tz) && <option value={tz}>{tz} (detected)</option>}
          {TIMEZONES.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </div>

      {/* Live preview */}
      <p className="text-xs text-muted-foreground italic">{preview}</p>

      {/* Advanced cron escape hatch */}
      {!showAdvanced ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => { setAdvancedCron(toCron(state)); setShowAdvanced(true); }}
        >
          Advanced: edit cron expression…
        </button>
      ) : (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Cron expression</div>
          <div className="flex gap-2 items-center">
            <input
              className={inputCls}
              disabled={locked}
              placeholder="0 9 * * 1-5"
              value={advancedCron}
              onChange={(e) => handleAdvanced(e.target.value)}
            />
            {fromCron(advancedCron) !== null && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline whitespace-nowrap"
                onClick={() => { setState(fromCron(advancedCron)!); setShowAdvanced(false); }}
              >
                ← Back to picker
              </button>
            )}
          </div>
        </div>
      )}

      {/* Activation note */}
      <p className="text-xs text-muted-foreground">Schedule activates when the agent is enabled.</p>

      {/* Fixed inputs */}
      {inputs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Fixed inputs</div>
          {inputs.map((inp) => (
            <div key={inp.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
              <span className="text-muted-foreground">=</span>
              <input
                className={inputCls}
                disabled={locked}
                placeholder="fixed value"
                value={fixedInputs[inp.name] ?? ""}
                onChange={(e) => {
                  const next = { ...fixedInputs, [inp.name]: e.target.value };
                  if (!e.target.value) delete next[inp.name];
                  onChange(showAdvanced ? advancedCron : toCron(state), tz, next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
