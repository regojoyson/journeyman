import { useEffect, useMemo, useState } from "react";
import {
  OPERATORS,
  rulesToJsonLogic,
  jsonLogicToRules,
  ruleError,
  type BuilderState,
  type Operator,
  type Rule,
  type ValueType,
} from "./AcceptIfBuilder.logic.ts";

interface Props {
  value: unknown | undefined;
  knownPaths: string[];
  readOnly?: boolean;
  onChange: (value: unknown | undefined) => void;
  datalistId: string;
}

type Mode = "builder" | "advanced";

const EMPTY_STATE: BuilderState = { combinator: "and", rules: [] };

export function AcceptIfBuilder({ value, knownPaths, readOnly, onChange, datalistId }: Props) {
  const initial = useMemo(() => deriveInitial(value), []);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [builder, setBuilder] = useState<BuilderState>(initial.state);
  const [draft, setDraft] = useState<string>(initial.draft);
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "builder") return;
    onChange(rulesToJsonLogic(builder));
  }, [mode, builder]);

  const switchTo = (next: Mode) => {
    if (next === mode) return;
    if (next === "advanced") {
      const json = rulesToJsonLogic(builder);
      setDraft(json === undefined ? "" : JSON.stringify(json, null, 2));
      setAdvancedError(null);
      setMode("advanced");
      return;
    }
    if (draft.trim() === "") {
      setBuilder(EMPTY_STATE);
      onChange(undefined);
      setAdvancedError(null);
      setMode("builder");
      return;
    }
    try {
      const parsedJson = JSON.parse(draft);
      const parsedState = jsonLogicToRules(parsedJson);
      if (!parsedState) {
        setAdvancedError("This expression is too complex for the visual builder. Edit as JSON or clear to use the builder.");
        return;
      }
      setBuilder(parsedState);
      onChange(parsedJson);
      setAdvancedError(null);
      setMode("builder");
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDraftChange = (text: string) => {
    setDraft(text);
    if (text.trim() === "") {
      onChange(undefined);
      setAdvancedError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      onChange(parsed);
      setAdvancedError(null);
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : String(e));
    }
  };

  const setRule = (idx: number, patch: Partial<Rule>) => {
    setBuilder(prev => ({
      ...prev,
      rules: prev.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const removeRule = (idx: number) => {
    setBuilder(prev => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }));
  };

  const addRule = () => {
    setBuilder(prev => ({
      ...prev,
      rules: [...prev.rules, { field: "", op: "eq", value: "" }],
    }));
  };

  return (
    <div className="je-acceptif">
      <datalist id={datalistId}>
        {knownPaths.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="je-acceptif__header">
        <span className="je-acceptif__mode">
          <button
            type="button"
            className={"je-acceptif__modebtn" + (mode === "builder" ? " je-acceptif__modebtn--on" : "")}
            disabled={readOnly}
            onClick={() => switchTo("builder")}
          >Visual</button>
          <button
            type="button"
            className={"je-acceptif__modebtn" + (mode === "advanced" ? " je-acceptif__modebtn--on" : "")}
            disabled={readOnly}
            onClick={() => switchTo("advanced")}
          >JSON</button>
        </span>
      </div>

      {mode === "builder" ? (
        <>
          <div className="je-acceptif__combinator">
            Match&nbsp;
            <select
              value={builder.combinator}
              disabled={readOnly || builder.rules.length < 2}
              onChange={e => setBuilder(prev => ({ ...prev, combinator: e.target.value as "and" | "or" }))}
            >
              <option value="and">All</option>
              <option value="or">Any</option>
            </select>
            &nbsp;of the following:
          </div>

          {builder.rules.length === 0 && (
            <div className="je-humantask__empty">No conditions — webhook payloads are accepted as-is.</div>
          )}

          {builder.rules.map((rule, idx) => {
            const err = ruleError(rule);
            const meta = OPERATORS.find(o => o.op === rule.op)!;
            return (
              <div
                key={idx}
                className={"je-acceptif__rule" + (err ? " je-acceptif__rule--invalid" : "")}
              >
                <input
                  type="text"
                  list={datalistId}
                  value={rule.field}
                  placeholder="$.issue.state"
                  title={'Dot-path into the incoming webhook payload (same vocabulary as "Payload source" on outputs).'}
                  disabled={readOnly}
                  onChange={e => setRule(idx, { field: e.target.value })}
                  style={{ flex: 2 }}
                />
                <select
                  value={rule.op}
                  disabled={readOnly}
                  onChange={e => setRule(idx, { op: e.target.value as Operator, value: "" })}
                  style={{ flex: 1 }}
                >
                  {OPERATORS.map(o => (
                    <option key={o.op} value={o.op}>{o.label}</option>
                  ))}
                </select>
                {meta.hasValue && (
                  <input
                    type="text"
                    value={rule.value ?? ""}
                    placeholder={meta.valueShape === "csv" ? "value1, value2, …" : "value"}
                    disabled={readOnly}
                    onChange={e => setRule(idx, { value: e.target.value })}
                    style={{ flex: 2 }}
                  />
                )}
                {(meta.op === "eq" || meta.op === "neq") && (
                  <select
                    value={rule.valueType ?? "string"}
                    disabled={readOnly}
                    onChange={e =>
                      setRule(idx, {
                        valueType: (e.target.value as ValueType) === "string"
                          ? undefined
                          : (e.target.value as ValueType),
                      })
                    }
                    title="Value type"
                  >
                    <option value="string">text</option>
                    <option value="number">number</option>
                    <option value="boolean">bool</option>
                  </select>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    className="je-humantask__chip-x"
                    aria-label="Remove condition"
                    onClick={() => removeRule(idx)}
                  >×</button>
                )}
                {err && <div className="je-acceptif__rule-err">{err}</div>}
              </div>
            );
          })}

          {!readOnly && (
            <button
              type="button"
              className="je-humantask__btn"
              onClick={addRule}
              style={{ marginTop: 6 }}
            >+ Add condition</button>
          )}
        </>
      ) : (
        <div className="je-acceptif__advanced">
          <textarea
            rows={6}
            value={draft}
            disabled={readOnly}
            placeholder='{"==": [{"var": "$.issue.fields.status.name"}, "Done"]}'
            onChange={e => onDraftChange(e.target.value)}
          />
          {advancedError && <p className="je-hint je-hint--error">{advancedError}</p>}
        </div>
      )}
    </div>
  );
}

function deriveInitial(value: unknown): { mode: Mode; state: BuilderState; draft: string } {
  if (value === undefined || value === null) {
    return { mode: "builder", state: EMPTY_STATE, draft: "" };
  }
  const parsed = jsonLogicToRules(value);
  if (parsed) {
    return { mode: "builder", state: parsed, draft: JSON.stringify(value, null, 2) };
  }
  return { mode: "advanced", state: EMPTY_STATE, draft: JSON.stringify(value, null, 2) };
}
