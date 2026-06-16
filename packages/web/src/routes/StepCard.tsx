import { useState } from "react";
import type { BuildPlan, CanonicalTool, Gap, StepBinding } from "@journeyman/core";
import { CANONICAL_TOOLS } from "@journeyman/core";
import {
  setStepModel, toggleStepTool, setStepMcpIds, setStepSandbox, mapSecretSlot, resolveGap,
} from "./plan-edits.ts";

export interface StepCardInventory {
  models: string[];
  mcps: { id: string; name: string }[];
  sandboxes: { id: string; name: string }[];
  secrets: string[];
}

export function StepCard(props: {
  plan: BuildPlan;
  binding: StepBinding;
  inventory: StepCardInventory;
  onChange: (next: BuildPlan) => void;
}) {
  const { plan, binding, inventory, onChange } = props;
  const id = binding.nodeId;
  const [showIo, setShowIo] = useState(false);
  const gaps = plan.gaps.filter((g) => g.nodeIds.includes(id));
  const isAi = binding.stepKind === "ai";
  const tools = (binding.uses.tools ?? []) as CanonicalTool[];

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-100">
          <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{binding.stepKind}</span>
          <span>{id}</span>
        </div>
        <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowIo((v) => !v)}>
          ⇄ I/O
        </button>
      </div>

      {/* Inputs / outputs reveal (human-readable wiring) */}
      {showIo && (
        <div className="mt-2 rounded bg-bg/60 p-2 text-xs text-slate-300">
          {binding.io.inputs.length === 0 && binding.io.outputs.length === 0 ? (
            <span className="text-slate-500">No wired inputs or outputs.</span>
          ) : (
            <>
              {binding.io.inputs.map((inp) => (
                <div key={inp.name}>← <b>{inp.name}</b> from {inp.from}</div>
              ))}
              {binding.io.outputs.map((out) => (
                <div key={out.name}>→ <b>{out.name}</b> ({out.type})</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Model (AI steps) */}
      {isAi && (
        <label className="mt-2 block text-xs text-slate-400">
          Model
          <input
            list={`models-${id}`}
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            defaultValue={binding.uses.model ?? ""}
            placeholder="(workflow default)"
            onBlur={(e) => onChange(setStepModel(plan, id, e.target.value))}
          />
          <datalist id={`models-${id}`}>
            {inventory.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
      )}

      {/* Tools (AI steps) */}
      {isAi && (
        <div className="mt-2">
          <div className="text-xs text-slate-400">Tools</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CANONICAL_TOOLS.map((t) => {
              const on = tools.includes(t);
              return (
                <button key={t}
                  className={on
                    ? "rounded bg-indigo-500/30 px-2 py-0.5 text-xs text-accent"
                    : "rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400"}
                  onClick={() => onChange(toggleStepTool(plan, id, t))}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* MCPs (AI steps) */}
      {isAi && inventory.mcps.length > 0 && (
        <label className="mt-2 block text-xs text-slate-400">
          MCP
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={(binding.uses.mcpIds ?? [])[0] ?? ""}
            onChange={(e) => onChange(setStepMcpIds(plan, id, e.target.value ? [e.target.value] : []))}>
            <option value="">(none)</option>
            {inventory.mcps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      {/* Sandbox (any step) */}
      {inventory.sandboxes.length > 0 && (
        <label className="mt-2 block text-xs text-slate-400">
          Sandbox
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={binding.uses.sandboxId ?? ""}
            onChange={(e) => onChange(setStepSandbox(plan, id, e.target.value || null))}>
            <option value="">(workflow default)</option>
            {inventory.sandboxes.map((sb) => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
          </select>
        </label>
      )}

      {/* Secret slots */}
      {(binding.uses.secrets ?? []).map((sec) => (
        <label key={sec.slot} className="mt-2 block text-xs text-slate-400">
          Secret · <code className="text-slate-300">{sec.slot}</code>
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={sec.secretName ?? ""}
            onChange={(e) => onChange(mapSecretSlot(plan, id, sec.slot, e.target.value || null))}>
            <option value="">(unmapped)</option>
            {inventory.secrets.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      ))}

      {/* Inline gaps on this step */}
      {gaps.map((g: Gap) => (
        <div key={g.id} className="mt-2 flex items-center justify-between rounded border border-warning/25 bg-warning/10 px-2 py-1 text-xs text-warning/90">
          <span>{g.required ? "⚠️ " : "• "}{g.reason}</span>
          <button className="rounded bg-amber-500/20 px-2 py-0.5 text-warning hover:bg-amber-500/30"
            onClick={() => onChange(resolveGap(plan, g.id))}>
            Resolve
          </button>
        </div>
      ))}
    </div>
  );
}
