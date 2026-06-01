import type { Shape, WorkflowInputValue } from "@journeyman/core";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";

export type InputMode = "value" | "reference";

/** Which literal-mode widget a field's expected shape calls for. */
export type LiteralWidget = "string" | "number" | "boolean" | "json";

/** Initial editor mode derived from the stored value. Empty → reference. */
export function modeForValue(value: WorkflowInputValue | undefined): InputMode {
  if (value?.kind === "ref") return "reference";
  if (value?.kind === "literal" || value?.kind === "template") return "value";
  return "reference";
}

/** Map an expected Shape to the literal-mode widget. Defaults to string. */
export function widgetForShape(expected: Shape | undefined): LiteralWidget {
  switch (expected?.type) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "json":
    case "object":
    case "array": return "json";
    default: return "string";
  }
}

/** JSON container expected by a shape, defaulting to "object". */
export function jsonContainerForShape(expected: Shape | undefined): "object" | "array" {
  if (expected?.type === "json") return expected.container;
  if (expected?.type === "array") return "array";
  return "object";
}

/** Reference mode → a single ref, or nothing. */
export function refSegmentsToInput(segs: Segment[]): WorkflowInputValue | undefined {
  const ref = soleRefOf(segs);
  return ref ? { kind: "ref", ref } : undefined;
}

/**
 * String Value mode → literal text, template (text + refs), a normalized sole
 * ref, or undefined when empty.
 */
export function valueSegmentsToInput(segs: Segment[]): WorkflowInputValue | undefined {
  const sole = soleRefOf(segs);
  if (sole) return { kind: "ref", ref: sole };
  const hasRef = segs.some(s => s.kind === "ref");
  const template = segmentsToTemplate(segs);
  if (template === "") return undefined;
  return hasRef ? { kind: "template", template } : { kind: "literal", value: template };
}

/** Initial segments for the string Value-mode editor from a stored value. */
export function inputToValueSegments(value: WorkflowInputValue | undefined): Segment[] {
  if (!value) return [];
  if (value.kind === "ref") return [{ kind: "ref", ref: value.ref }];
  if (value.kind === "template") return parseTemplate(value.template);
  if (value.kind === "literal" && typeof value.value === "string") return [{ kind: "text", text: value.value }];
  return [];
}

/** Initial segments for the reference-mode editor. */
export function inputToRefSegments(value: WorkflowInputValue | undefined): Segment[] {
  return value?.kind === "ref" ? [{ kind: "ref", ref: value.ref }] : [];
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse raw textarea text into a JSON literal of the expected container. */
export function parseJsonLiteral(raw: string, container: "object" | "array"): JsonParseResult {
  if (raw.trim() === "") return { ok: false, error: "Enter JSON" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const isArray = Array.isArray(parsed);
  if (container === "array" && !isArray) return { ok: false, error: "Expected a JSON array" };
  if (container === "object" && (isArray || parsed === null || typeof parsed !== "object")) {
    return { ok: false, error: "Expected a JSON object" };
  }
  return { ok: true, value: parsed };
}

/** Stringify an existing literal value for the JSON textarea buffer. */
export function jsonLiteralToText(value: WorkflowInputValue | undefined): string {
  if (value?.kind === "literal" && value.value !== undefined) {
    try { return JSON.stringify(value.value, null, 2); } catch { return ""; }
  }
  return "";
}

export function numberLiteralValue(value: WorkflowInputValue | undefined): number | undefined {
  return value?.kind === "literal" && typeof value.value === "number" ? value.value : undefined;
}

export function booleanLiteralValue(value: WorkflowInputValue | undefined): boolean | undefined {
  return value?.kind === "literal" && typeof value.value === "boolean" ? value.value : undefined;
}
