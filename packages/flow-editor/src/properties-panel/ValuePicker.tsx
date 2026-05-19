import { useState } from "react";
import type { Shape } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";
import { ShapeTree } from "./ShapeTree.tsx";

interface Props {
  sources: UpstreamSource[];
  expected?: Shape;
  /** Replace the field with a binding (sets node.inputs[key] = { kind: "ref", ref }). */
  onPick: (ref: string) => void;
  /** Insert ${ref} as text into the field's literal value (writes to node.config[key]). Optional — when omitted the insert button is hidden. */
  onInsert?: (ref: string) => void;
  onClose: () => void;
}

function refForPath(source: UpstreamSource, scope: UpstreamField["scope"], path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return `workflow.input.${tail}`;
  if (scope === "input")     return `${source.id}.input.${tail}`;
  /* output */               return `${source.id}.output.${tail}`;
}

function refForCustom(source: UpstreamSource, scope: UpstreamField["scope"], path: string): string {
  if (scope === "run-input") return `workflow.input.${path}`;
  if (scope === "input")     return `${source.id}.input.${path}`;
  return `${source.id}.output.${path}`;
}

export function ValuePicker({ sources, expected, onPick, onInsert, onClose }: Props) {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(sources[0]?.id ?? null);
  const [customMode, setCustomMode] = useState<{ scope: UpstreamField["scope"] } | null>(null);
  const [custom, setCustom] = useState("");
  const cur = sources.find(s => s.id === activeSourceId);

  return (
    <div className="value-picker">
      <div className="value-picker-help">
        Click a tree node to <b>replace</b>. Click <b>+</b> to <b>insert into the existing text</b> (e.g. <code>feature/${"${issueRef}"}</code>).
      </div>
      <div className="value-picker-cols">
        <ul className="vp-sources">
          {sources.map(s => (
            <li
              key={s.id || "_run"}
              className={s.id === activeSourceId ? "active" : ""}
              onClick={() => { setActiveSourceId(s.id); setCustomMode(null); }}
            >
              {s.label}
            </li>
          ))}
        </ul>
        <div className="vp-fields-container">
          {cur?.groups.length === 0 && (
            <div className="vp-empty">No declared fields.</div>
          )}
          {cur?.groups.map(g => (
            <div key={g.title} className="vp-group">
              <div className="vp-group-title">{g.title}</div>
              <ul className="vp-fields">
                {g.fields.map(f => (
                  <li key={f.name} title={f.description}>
                    <ShapeTree
                      shape={f.shape}
                      path={[f.name]}
                      expected={expected}
                      onBind={p => onPick(refForPath(cur!, g.scope, p))}
                      onInsert={onInsert ? p => onInsert(refForPath(cur!, g.scope, p)) : undefined}
                    />
                  </li>
                ))}
                {cur.kind !== "run-input" && (
                  <li
                    className="vp-custom"
                    onClick={() => setCustomMode({ scope: g.scope })}
                  >+ custom {g.scope} field…</li>
                )}
                {cur.kind === "run-input" && (
                  <li className="vp-custom" onClick={() => setCustomMode({ scope: "run-input" })}>+ custom field…</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
      {customMode && cur && (
        <div className="vp-custom-input">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder={`${customMode.scope} field path`}
          />
          <button onClick={() => { if (custom) onPick(refForCustom(cur, customMode.scope, custom)); }}>Replace</button>
          {onInsert && (
            <button onClick={() => { if (custom) onInsert(refForCustom(cur, customMode.scope, custom)); }}>Insert</button>
          )}
        </div>
      )}
      <button className="vp-close" onClick={onClose}>Close</button>
    </div>
  );
}
