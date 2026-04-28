// packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx
//
// T9: ValuePicker reuse for loop / timer expression surfaces.
//
// Conductor expression surfaces (loopCondition, until, duration) accept
// the literal string `${ref}`. JSONLogic surfaces (edge condition) wrap as
// `{ var: ref }`.
//
// TODO(T9): Add an Inspector / edge-properties surface so that
// FlowEdge.condition (JSONLogic) can be edited with the {x} ValuePicker
// button. Today, edges are not selectable in the PropertiesPanel — they
// only render via ConditionalEdge.tsx with a static branch label. Once an
// edge inspector exists, plug ValuePicker in there using
// `surface = "jsonlogic"` and merge the picked `{ var: ref }` into the
// existing JSONLogic value (or replace if empty).
import { useState } from "react";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import { ValuePicker } from "./ValuePicker.tsx";
import { useUpstreamSources } from "./use-upstream-sources.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

interface Props {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function insertRef(ref: string, surface: "jsonlogic" | "expr"): unknown {
  return surface === "jsonlogic" ? { var: ref } : "${" + ref + "}";
}

interface ExprFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  sources: ReturnType<typeof useUpstreamSources>;
}

function ExprField({ label, value, onChange, readOnly, sources }: ExprFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div className="je-field">
      <label className="je-field__label">{label}</label>
      <div className="je-field__row" style={{ display: "flex", gap: 4, position: "relative" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          title="Insert reference"
          onClick={() => setShowPicker(true)}
          disabled={readOnly}
        >
          {"{x}"}
        </button>
        {showPicker && (
          <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 10 }}>
            <ValuePicker
              sources={sources}
              onPick={(ref) => {
                const literal = insertRef(ref, "expr") as string;
                // Append at end. (Cursor-aware insertion would require a ref
                // to the input element; append is sufficient for v0.)
                onChange((value ?? "") + literal);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ControlNodeConfigTab({ flow, node, onChange, readOnly }: Props) {
  const catalog = usePhaseCatalog();
  const sources = useUpstreamSources(flow, node.id, catalog);
  const cfg = (node.config ?? {}) as Record<string, unknown>;

  const setCfg = (patch: Record<string, unknown>) => {
    onChange({ ...node, config: { ...cfg, ...patch } });
  };

  if (node.type === "loop") {
    return (
      <div className="je-tab je-tab--config">
        <ExprField
          label="Loop condition (expression)"
          value={(cfg.loopCondition as string) ?? ""}
          onChange={(v) => setCfg({ loopCondition: v })}
          readOnly={readOnly}
          sources={sources}
        />
        <p className="je-hint">
          Use the {"{x}"} button to insert a reference like <code>{"${nodeId.output.field}"}</code>.
          The loop body iterates while this expression is truthy.
        </p>
      </div>
    );
  }

  if (node.type === "timer") {
    return (
      <div className="je-tab je-tab--config">
        <ExprField
          label="Duration"
          value={(cfg.duration as string) ?? ""}
          onChange={(v) => setCfg({ duration: v })}
          readOnly={readOnly}
          sources={sources}
        />
        <ExprField
          label="Until (optional)"
          value={(cfg.until as string) ?? ""}
          onChange={(v) => setCfg({ until: v })}
          readOnly={readOnly}
          sources={sources}
        />
      </div>
    );
  }

  return null;
}
