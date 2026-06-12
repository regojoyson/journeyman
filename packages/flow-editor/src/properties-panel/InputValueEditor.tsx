import { useEffect, useState } from "react";
import type { Shape, WorkflowInputValue } from "@journeyman/core";
import { MentionInput } from "./MentionInput.tsx";
import type { MentionField } from "./mention-fields.ts";
import type { Segment } from "./mention-serialize.ts";
import {
  modeForValue, widgetForShape, jsonContainerForShape,
  refWithPathSegmentsToInput, valueSegmentsToInput,
  inputToValueSegments, inputToRefSegments,
  parseJsonLiteral, jsonLiteralToText,
  numberLiteralValue, booleanLiteralValue,
  type InputMode,
} from "./input-value-serialize.ts";
import { splitRefPath, validatePathTail } from "./ref-path.ts";
import { InputHelp } from "./InputHelp.tsx";

interface Props {
  value: WorkflowInputValue | undefined;
  expected: Shape | undefined;
  fields: MentionField[];
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  onChange: (next: WorkflowInputValue | undefined) => void;
}

export function InputValueEditor({ value, expected, fields, readOnly, required, placeholder, onChange }: Props) {
  const [mode, setMode] = useState<InputMode>(() => modeForValue(value));
  const widget = widgetForShape(expected);
  const container = jsonContainerForShape(expected);

  const [jsonText, setJsonText] = useState<string>(() => jsonLiteralToText(value));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Reference-mode drilling: the picked base ref + an inline path tail live in
  // ONE field — base rendered as a chip, the tail as trailing text after it.
  const refSplit =
    value?.kind === "ref" ? splitRefPath(value.ref, fields) : { baseRef: "", tail: "" };
  const baseField = fields.find(f => f.ref === refSplit.baseRef);
  const tailCheck = validatePathTail(refSplit.tail);

  // Segments fed to the single MentionInput: base chip, then the path tail text.
  const refSegments: Segment[] = refSplit.baseRef
    ? (refSplit.tail
        ? [{ kind: "ref", ref: refSplit.baseRef }, { kind: "text", text: refSplit.tail }]
        : [{ kind: "ref", ref: refSplit.baseRef }])
    : inputToRefSegments(value);

  // Re-sync the JSON buffer when the committed value changes externally
  // (e.g. selecting a different node). No-op while the buffer already encodes
  // the current value, so the user's own typing is never clobbered.
  useEffect(() => {
    if (widget !== "json") return;
    const parsed = parseJsonLiteral(jsonText, container);
    const bufMatches =
      parsed.ok && value?.kind === "literal" &&
      JSON.stringify(parsed.value) === JSON.stringify(value.value);
    if (!bufMatches) setJsonText(jsonLiteralToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const switchMode = (next: InputMode) => {
    if (next === mode) return;
    setMode(next);
    onChange(undefined); // clear to avoid kind/widget mismatch across modes
    if (next === "value" && widget === "json") { setJsonText(""); setJsonError(null); }
  };

  return (
    <div className="je-input-value">
      {!readOnly && (
        <div className="je-input-value__mode-row">
          <div className="je-input-value__modes" role="tablist">
            <button
              type="button" role="tab" aria-selected={mode === "value"}
              className={`je-input-value__mode${mode === "value" ? " je-input-value__mode--active" : ""}`}
              onClick={() => switchMode("value")}
            >Value</button>
            <button
              type="button" role="tab" aria-selected={mode === "reference"}
              className={`je-input-value__mode${mode === "reference" ? " je-input-value__mode--active" : ""}`}
              onClick={() => switchMode("reference")}
            >@ Reference</button>
          </div>
          <InputHelp />
        </div>
      )}

      {mode === "reference" && (
        <>
          <MentionInput
            value={refSegments}
            fields={fields}
            readOnly={readOnly}
            expected={expected}
            placeholder={placeholder ?? (required ? "Required — @ to bind from upstream" : "@ to bind from upstream")}
            onChange={segs => onChange(refWithPathSegmentsToInput(segs))}
          />
          {baseField?.drillable && refSplit.tail === "" && !readOnly && (
            <div className="je-input-value__hint">
              Tip: type a path right after the chip to reach inside — e.g. <code>.title</code> or <code>[0]</code>.
            </div>
          )}
          {!tailCheck.ok && <div className="je-input-value__path-error">{tailCheck.error}</div>}
        </>
      )}

      {mode === "value" && widget === "string" && (
        <>
          <MentionInput
            value={inputToValueSegments(value)}
            fields={fields}
            readOnly={readOnly}
            expected={expected}
            placeholder={placeholder ?? "Type text and @mention to combine — e.g. @fullName/@ticketNumber"}
            onChange={segs => onChange(valueSegmentsToInput(segs))}
          />
          {!readOnly && (
            <div className="je-input-value__hint">
              Mix text and multiple @mentions to combine values into one string.
            </div>
          )}
        </>
      )}

      {mode === "value" && widget === "number" && (
        <input
          type="number"
          className="je-input-value__number"
          disabled={readOnly}
          value={numberLiteralValue(value) ?? ""}
          placeholder={placeholder ?? "Number"}
          onChange={e => {
            const raw = e.target.value;
            if (raw === "") { onChange(undefined); return; }
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange({ kind: "literal", value: n });
          }}
        />
      )}

      {mode === "value" && widget === "boolean" && (
        <select
          className="je-input-value__boolean"
          disabled={readOnly}
          value={booleanLiteralValue(value) === undefined ? "" : String(booleanLiteralValue(value))}
          onChange={e => {
            const v = e.target.value;
            if (v === "") { onChange(undefined); return; }
            onChange({ kind: "literal", value: v === "true" });
          }}
        >
          <option value="">— unset —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}

      {mode === "value" && widget === "json" && (
        <div className="je-input-value__json">
          <textarea
            className="je-input-value__json-area"
            disabled={readOnly}
            value={jsonText}
            placeholder={container === "array" ? "[ ... ]" : "{ ... }"}
            onChange={e => {
              const raw = e.target.value;
              setJsonText(raw);
              if (raw.trim() === "") { setJsonError(null); onChange(undefined); return; }
              const res = parseJsonLiteral(raw, container);
              if (res.ok) { setJsonError(null); onChange({ kind: "literal", value: res.value }); }
              else { setJsonError(res.error); } // keep last committed value; do not emit
            }}
          />
          {jsonError && <div className="je-input-value__json-error">{jsonError}</div>}
        </div>
      )}
    </div>
  );
}
