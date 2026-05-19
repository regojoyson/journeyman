/**
 * Shape — the runtime-resolved type of a value flowing through the pipeline.
 * Phase outputs and inputs declare shapes; the flow editor uses them to render
 * the value picker and validate ref bindings at flow-save time.
 *
 * Discriminated union; resolveShape() flattens "ref" entries against the
 * named-shape registry in shapes.ts.
 */
export type Shape =
  | { type: "string";  description?: string }
  | { type: "number";  description?: string }
  | { type: "boolean"; description?: string }
  | { type: "object";  fields: Record<string, Shape>; named?: string; description?: string }
  | { type: "array";   items: Shape; description?: string }
  | { type: "ref";     name: string; description?: string };

/**
 * Replacement for the legacy InputFieldMeta. Each input now declares a Shape
 * rather than a primitive type string.
 */
export interface InputField {
  shape: Shape;
  label?: string;
  required?: boolean;
  /** No typed UI; must be bound from upstream. */
  bindOnly?: boolean;
}
export type InputFields = Record<string, InputField>;

/**
 * Replacement for the legacy OutputSchema. Each output field declares a Shape.
 */
export type OutputSchema = Record<string, Shape>;
