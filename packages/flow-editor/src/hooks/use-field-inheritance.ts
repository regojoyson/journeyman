export type FieldState = "inherited" | "override" | "local" | "unset";

export interface FieldInheritance {
  state: FieldState;
  /** The effective value — node value if set, default value if inherited, undefined if unset. */
  resolvedValue: unknown;
}

/**
 * Compute the inheritance state for a single config field.
 *
 * @param nodeValue    - The raw value on the node (undefined = not set on node).
 * @param defaultValue - The raw value from flow.defaults (undefined = no default).
 */
export function useFieldInheritance(
  nodeValue: unknown,
  defaultValue: unknown,
): FieldInheritance {
  const hasNode    = nodeValue !== undefined && nodeValue !== null;
  const hasDefault = defaultValue !== undefined;

  if (nodeValue === null) {
    // null = explicit suppress sentinel — show as suppressed sub-state
    return { state: "inherited", resolvedValue: undefined };
  }
  if (!hasNode && !hasDefault) {
    return { state: "unset", resolvedValue: undefined };
  }
  if (!hasNode && hasDefault) {
    return { state: "inherited", resolvedValue: defaultValue };
  }
  if (hasNode && !hasDefault) {
    return { state: "local", resolvedValue: nodeValue };
  }
  // Both set — node overrides default
  return { state: "override", resolvedValue: nodeValue };
}
