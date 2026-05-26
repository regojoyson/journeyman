import { useMemo, useState } from "react";
import type { JsonLogicExpr } from "@journeyman/core";
import { MentionInput } from "../properties-panel/MentionInput.tsx";
import { toMentionFields } from "../properties-panel/mention-fields.ts";
import { soleRefOf, type Segment } from "../properties-panel/mention-serialize.ts";
import type { UpstreamSource } from "../properties-panel/use-upstream-sources.ts";
import { shapeForRef } from "./shape-for-ref.ts";

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";
type Connector = "and" | "or";

interface Row {
  varPath: string;
  op: Op;
  value: string;
}

interface Props {
  value: JsonLogicExpr | undefined;
  sources: UpstreamSource[];
  onChange: (expr: JsonLogicExpr | undefined) => void;
}

export function ConditionBuilder({ value, sources, onChange }: Props) {
  const [showJson, setShowJson] = useState(false);

  const initial = useMemo(() => exprToRows(value), [value]);
  const [connector, setConnector] = useState<Connector>(initial.connector);
  const [rows, setRows] = useState<Row[]>(initial.rows);

  function commit(nextRows: Row[], nextConnector: Connector) {
    setRows(nextRows);
    setConnector(nextConnector);
    onChange(rowsToExpr(nextRows, nextConnector, sources));
  }

  return (
    <div className="je-condition-builder">
      {showJson ? (
        <pre className="je-condition-builder__json">
          {JSON.stringify(value ?? null, null, 2)}
        </pre>
      ) : (
        <>
          <div className="je-condition-builder__connector">
            <label>
              <input
                type="radio"
                name="connector"
                checked={connector === "and"}
                onChange={() => commit(rows, "and")}
              />
              AND
            </label>
            <label>
              <input
                type="radio"
                name="connector"
                checked={connector === "or"}
                onChange={() => commit(rows, "or")}
              />
              OR
            </label>
          </div>
          {rows.map((r, i) => (
            <RowEditor
              key={i}
              row={r}
              sources={sources}
              onChange={(nr) => {
                const next = rows.slice();
                next[i] = nr;
                commit(next, connector);
              }}
              onRemove={() => commit(rows.filter((_, j) => j !== i), connector)}
            />
          ))}
          <button
            type="button"
            onClick={() => commit([...rows, { varPath: "", op: "==", value: "" }], connector)}
          >
            + Add row
          </button>
        </>
      )}
      <button
        type="button"
        className="je-condition-builder__toggle"
        onClick={() => setShowJson(s => !s)}
      >
        {showJson ? "Hide JSON" : "Show JSON"}
      </button>
    </div>
  );
}

function RowEditor(p: {
  row: Row;
  sources: UpstreamSource[];
  onChange: (r: Row) => void;
  onRemove: () => void;
}) {
  const leafShape = useMemo(() => shapeForRef(p.row.varPath, p.sources), [p.row.varPath, p.sources]);
  const leafType = leafShape?.type;
  const mentionFields = useMemo(() => toMentionFields(p.sources), [p.sources]);

  return (
    <div className="je-condition-row">
      <div className="je-condition-row__lhs">
        <MentionInput
          value={p.row.varPath ? [{ kind: "ref", ref: p.row.varPath }] : []}
          fields={mentionFields}
          placeholder="@ to pick a value"
          onChange={(segs: Segment[]) => p.onChange({ ...p.row, varPath: soleRefOf(segs) ?? "" })}
        />
      </div>
      <select
        value={p.row.op}
        onChange={(e) => p.onChange({ ...p.row, op: e.target.value as Op })}
      >
        {(["==","!=","<","<=",">",">=","in"] as Op[]).map(op => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      {leafType === "boolean" ? (
        <select
          value={p.row.value}
          onChange={(e) => p.onChange({ ...p.row, value: e.target.value })}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          type={leafType === "number" ? "number" : "text"}
          value={p.row.value}
          onChange={(e) => p.onChange({ ...p.row, value: e.target.value })}
        />
      )}
      <button type="button" onClick={p.onRemove} aria-label="Remove row">×</button>
    </div>
  );
}

function exprToRows(expr: JsonLogicExpr | undefined): { connector: Connector; rows: Row[] } {
  if (expr === undefined || expr === null || typeof expr !== "object") {
    return { connector: "and", rows: [] };
  }
  if ("and" in expr) return { connector: "and", rows: (expr.and as JsonLogicExpr[]).map(opToRow) };
  if ("or"  in expr) return { connector: "or",  rows: (expr.or  as JsonLogicExpr[]).map(opToRow) };
  return { connector: "and", rows: [opToRow(expr)] };
}

function opToRow(expr: JsonLogicExpr): Row {
  if (typeof expr !== "object" || expr === null) return { varPath: "", op: "==", value: "" };
  const keys = Object.keys(expr);
  const op = keys[0] as Op;
  const arr = (expr as Record<string, unknown>)[op] as [unknown, unknown];
  if (!Array.isArray(arr) || arr.length !== 2) return { varPath: "", op: "==", value: "" };
  const lhs = arr[0];
  const rhs = arr[1];
  const varPath = (lhs && typeof lhs === "object" && "var" in (lhs as object))
    ? String((lhs as { var: string }).var)
    : "";
  return { varPath, op, value: rhs == null ? "" : String(rhs) };
}

function rowsToExpr(rows: Row[], connector: Connector, sources: UpstreamSource[]): JsonLogicExpr | undefined {
  const valid = rows.filter(r => r.varPath);
  if (valid.length === 0) return undefined;
  const exprs = valid.map(r => rowToExpr(r, sources));
  if (exprs.length === 1) return exprs[0];
  return { [connector]: exprs } as JsonLogicExpr;
}

function rowToExpr(r: Row, sources: UpstreamSource[]): JsonLogicExpr {
  const t = shapeForRef(r.varPath, sources)?.type;
  let v: JsonLogicExpr;
  if (t === "number") v = Number(r.value);
  else if (t === "boolean") v = r.value === "true";
  else v = r.value;
  return { [r.op]: [{ var: r.varPath }, v] } as JsonLogicExpr;
}
