import { useState } from "react";
import type { Shape } from "@journeyman/core";
import { resolveShape, shapesEqual } from "@journeyman/core";

interface Props {
  shape: Shape;
  path: string[];
  onBind: (path: string[]) => void;
  onInsert?: (path: string[]) => void;
  expected?: Shape;
}

export function ShapeTree({ shape, path, onBind, onInsert, expected }: Props) {
  const [open, setOpen] = useState(true);
  let resolved: Shape;
  try {
    resolved = resolveShape(shape);
  } catch {
    resolved = shape;
  }
  let compatible = false;
  if (expected) {
    try {
      compatible = shapesEqual(resolved, expected);
    } catch {
      compatible = false;
    }
  }

  const label = labelFor(path, resolved);

  return (
    <div className={`vp-shape-node${compatible ? " vp-shape-node--compatible" : ""}`}>
      <div className="vp-shape-row">
        <button
          type="button"
          className="vp-shape-bind"
          onClick={() => onBind(path)}
          title={compatible ? "Bind (compatible)" : "Bind"}
        >
          {label}
        </button>
        {onInsert && (
          <button
            type="button"
            className="vp-shape-insert"
            onClick={() => onInsert(path)}
            title="insert ${...} into existing text"
          >+</button>
        )}
        {(resolved.type === "object" || resolved.type === "array") && (
          <button
            type="button"
            className="vp-shape-toggle"
            onClick={() => setOpen(o => !o)}
          >{open ? "▾" : "▸"}</button>
        )}
      </div>
      {open && resolved.type === "object" && (
        <ul className="vp-shape-children">
          {Object.entries(resolved.fields).map(([k, child]) => (
            <li key={k}>
              <ShapeTree
                shape={child}
                path={[...path, k]}
                onBind={onBind}
                onInsert={onInsert}
                expected={expected}
              />
            </li>
          ))}
        </ul>
      )}
      {open && resolved.type === "array" && (
        <ul className="vp-shape-children">
          <li>
            <ShapeTree
              shape={resolved.items}
              path={[...path, "[item]"]}
              onBind={onBind}
              onInsert={onInsert}
              expected={expected}
            />
          </li>
        </ul>
      )}
    </div>
  );
}

function labelFor(path: string[], s: Shape): string {
  const last = path.length === 0 ? "(root)" : path[path.length - 1];
  const tag = shapeTag(s);
  return `${last} : ${tag}`;
}

function shapeTag(s: Shape): string {
  switch (s.type) {
    case "string":
    case "number":
    case "boolean": return s.type;
    case "ref":     return s.name;
    case "object":  return s.named ?? "object";
    case "array":   return `${shapeTag(s.items)}[]`;
  }
}
