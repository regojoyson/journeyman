import type { JSX } from "react";
import type { WorkflowAttributeDef } from "@journeyman/core";

type AttrType = WorkflowAttributeDef["type"];

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse the raw editor string for an attribute of the given type into a typed value. */
export function parseAttributeValue(type: AttrType, raw: string): ParseResult {
  switch (type) {
    case "string":
      return { ok: true, value: raw };
    case "number": {
      if (raw.trim() === "" || Number.isNaN(Number(raw))) {
        return { ok: false, error: "Not a valid number" };
      }
      return { ok: true, value: Number(raw) };
    }
    case "boolean":
      return { ok: true, value: raw === "true" };
    case "json-object":
    case "json-array": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, error: "Invalid JSON" };
      }
      const isArray = Array.isArray(parsed);
      if (type === "json-object" && (isArray || typeof parsed !== "object" || parsed === null)) {
        return { ok: false, error: "Expected a JSON object" };
      }
      if (type === "json-array" && !isArray) {
        return { ok: false, error: "Expected a JSON array" };
      }
      return { ok: true, value: parsed };
    }
  }
}

/** Stringify a stored attribute value back to the raw editor string. */
export function attributeValueToRaw(type: AttrType, value: unknown): string {
  if (type === "string") return typeof value === "string" ? value : "";
  if (type === "number") return value == null ? "" : String(value);
  if (type === "boolean") return value === true ? "true" : "false";
  // json-object / json-array
  try {
    return value === undefined ? "" : JSON.stringify(value);
  } catch {
    return "";
  }
}

export interface AttributeValueFieldProps {
  type: AttrType;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

export function AttributeValueField({ type, value, disabled, onChange }: AttributeValueFieldProps): JSX.Element {
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  const raw = attributeValueToRaw(type, value);

  function commit(next: string): void {
    const result = parseAttributeValue(type, next);
    if (result.ok) onChange(result.value);
    // Invalid values are not committed to the def; the field shows an error
    // and the table-level validation (InputsTab) blocks an invalid save.
  }

  if (type === "json-object" || type === "json-array") {
    const invalid = !parseAttributeValue(type, raw).ok && raw.trim() !== "";
    return (
      <textarea
        className={invalid ? "jm-inputs-tab__value-invalid" : undefined}
        disabled={disabled}
        defaultValue={raw}
        onBlur={(e) => commit(e.target.value)}
        rows={2}
      />
    );
  }

  return (
    <input
      type={type === "number" ? "number" : "text"}
      disabled={disabled}
      defaultValue={raw}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
