type Schema = Record<string, unknown>;

function isObject(v: unknown): v is Schema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstVariant(schema: Schema): Schema | null {
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const arr = schema[key];
    if (Array.isArray(arr) && arr.length > 0 && isObject(arr[0])) {
      return arr[0] as Schema;
    }
  }
  return null;
}

function stringValue(schema: Schema): string {
  if (typeof schema.default === "string") return schema.default;
  if (typeof schema.example === "string") return schema.example;
  if (Array.isArray(schema.enum) && typeof schema.enum[0] === "string") {
    return schema.enum[0];
  }
  return "";
}

function numberValue(schema: Schema): number {
  if (typeof schema.default === "number") return schema.default;
  if (typeof schema.example === "number") return schema.example;
  return 0;
}

function booleanValue(schema: Schema): boolean {
  if (typeof schema.default === "boolean") return schema.default;
  if (typeof schema.example === "boolean") return schema.example;
  return false;
}

export function skeletonFromSchema(schema: unknown): unknown {
  if (!isObject(schema)) return null;

  const variant = firstVariant(schema);
  if (variant) return skeletonFromSchema(variant);

  const type = schema.type;
  if (type === "object" || (type === undefined && isObject(schema.properties))) {
    const props = isObject(schema.properties) ? schema.properties : {};
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(props)) {
      out[key] = skeletonFromSchema(sub);
    }
    return out;
  }
  if (type === "array") {
    const items = schema.items;
    if (isObject(items)) return [skeletonFromSchema(items)];
    return [];
  }
  if (type === "string") return stringValue(schema);
  if (type === "integer" || type === "number") return numberValue(schema);
  if (type === "boolean") return booleanValue(schema);
  if (type === "null") return null;
  return null;
}
