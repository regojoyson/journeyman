import type { Shape } from "@journeyman/core";
import { resolveShape } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

export interface MentionField {
  ref: string;
  sourceId: string;
  sourceLabel: string;
  showId: boolean;
  fieldPath: string;
  type?: string;
  /** Resolved leaf shape — used for type-compatibility checks against a target field. */
  shape: Shape;
}

function refFor(scope: UpstreamField["scope"], sourceId: string, path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return `workflow.input.${tail}`;
  if (scope === "workflow-attribute") return `workflow.attribute.${tail}`;
  if (scope === "input") return `${sourceId}.input.${tail}`;
  return `${sourceId}.output.${tail}`;
}

function fieldPathFor(scope: UpstreamField["scope"], path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return tail;
  if (scope === "workflow-attribute") return tail;
  if (scope === "input") return `input.${tail}`;
  return `output.${tail}`;
}

interface Leaf { path: string[]; type?: string; shape: Shape }

function flatten(shape: Shape, prefix: string[]): Leaf[] {
  let resolved: Shape;
  try { resolved = resolveShape(shape); } catch { resolved = shape; }
  if (resolved.type === "object") {
    const entries = Object.entries(resolved.fields);
    if (entries.length === 0) return [{ path: prefix, type: "object", shape: resolved }];
    return entries.flatMap(([k, sub]) => flatten(sub, [...prefix, k]));
  }
  if (resolved.type === "array") return [{ path: prefix, type: "array", shape: resolved }];
  if (resolved.type === "json") {
    return [{ path: prefix, type: resolved.container === "object" ? "json object" : "json array", shape: resolved }];
  }
  return [{ path: prefix, type: resolved.type, shape: resolved }];
}

export function toMentionFields(sources: UpstreamSource[]): MentionField[] {
  const labelCounts = new Map<string, number>();
  for (const s of sources) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);

  const out: MentionField[] = [];
  for (const source of sources) {
    const showId = (labelCounts.get(source.label) ?? 0) > 1 && source.kind === "node";
    for (const group of source.groups) {
      for (const field of group.fields) {
        for (const leaf of flatten(field.shape, [field.name])) {
          out.push({
            ref: refFor(group.scope, source.id, leaf.path),
            sourceId: source.id,
            sourceLabel: source.label,
            showId,
            fieldPath: fieldPathFor(group.scope, leaf.path),
            type: leaf.type,
            shape: leaf.shape,
          });
        }
      }
    }
  }
  return out;
}
