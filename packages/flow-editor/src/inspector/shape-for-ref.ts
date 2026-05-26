import type { Shape } from "@journeyman/core";
import { resolveShape } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "../properties-panel/use-upstream-sources.ts";

/**
 * Resolve a ref string emitted by ValuePicker (e.g. "workflow.input.x",
 * "stepId.input.x", "stepId.output.x.y") to its leaf Shape by walking
 * `sources`. Returns undefined when the ref does not match anything declared.
 */
export function shapeForRef(ref: string, sources: UpstreamSource[]): Shape | undefined {
  if (!ref) return undefined;
  const parts = ref.split(".");
  if (parts.length < 3) return undefined;

  let source: UpstreamSource | undefined;
  let scope: UpstreamField["scope"];
  let tail: string[];

  if (parts[0] === "workflow" && parts[1] === "input") {
    source = sources.find(s => s.kind === "run-input");
    scope = "run-input";
    tail = parts.slice(2);
  } else if (parts[1] === "input" || parts[1] === "output") {
    source = sources.find(s => s.kind === "node" && s.id === parts[0]);
    scope = parts[1] as "input" | "output";
    tail = parts.slice(2);
  } else {
    return undefined;
  }
  if (!source || tail.length === 0) return undefined;

  const group = source.groups.find(g => g.scope === scope);
  if (!group) return undefined;

  const field = group.fields.find(f => f.name === tail[0]);
  if (!field) return undefined;

  return descend(field.shape, tail.slice(1));
}

function descend(shape: Shape, rest: string[]): Shape | undefined {
  if (rest.length === 0) return shape;
  const resolved = resolveShape(shape);
  if (resolved.type !== "object") return undefined;
  const sub = resolved.fields[rest[0]];
  if (!sub) return undefined;
  return descend(sub, rest.slice(1));
}
