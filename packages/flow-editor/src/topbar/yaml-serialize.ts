// Minimal JSON → YAML serializer scoped to plain data (no cycles, no anchors,
// no Date/Symbol/Function). Sufficient for FlowGraph export.
//
// Pure function, no deps.

const RESERVED = new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]);
const SAFE_BARE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function quoteString(s: string): string {
  // Need quoting when:
  //  - empty
  //  - reserved keyword
  //  - starts with whitespace, special char, or digit (could parse as number)
  //  - contains \n, : (with space after), #, &, *, !, %, @, `, , [], {}, |, >, "
  if (s === "") return '""';
  if (RESERVED.has(s.toLowerCase())) return JSON.stringify(s);
  if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return JSON.stringify(s);
  if (/[\n\t\r"\\]/.test(s)) return JSON.stringify(s);
  if (/:\s|^\s|\s$/.test(s)) return JSON.stringify(s);
  if (/^-?\d/.test(s)) return JSON.stringify(s); // looks numeric — quote to keep as string
  return s;
}

function quoteKey(k: string): string {
  if (SAFE_BARE.test(k) && !RESERVED.has(k.toLowerCase())) return k;
  return JSON.stringify(k);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emit(value: unknown, indent: number, atKeyValue: boolean): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "string") return quoteString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lines = value.map(item => {
      const rendered = emit(item, indent + 1, false);
      if (isPlainObject(item) || Array.isArray(item)) {
        // Block style: "- " followed by inline-rendered first key on same line
        if (isPlainObject(item)) {
          const inner = renderObjectInline(item as Record<string, unknown>, indent + 1);
          return `${pad}-${inner}`;
        }
        return `${pad}- ${rendered}`;
      }
      return `${pad}- ${rendered}`;
    });
    return atKeyValue ? "\n" + lines.join("\n") : lines.join("\n");
  }

  if (isPlainObject(value)) {
    return renderObjectInline(value as Record<string, unknown>, indent);
  }

  return JSON.stringify(value);
}

function renderObjectInline(obj: Record<string, unknown>, indent: number): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return " {}";
  const pad = "  ".repeat(indent);
  const lines = keys.map((k, idx) => {
    const v = obj[k];
    const keyStr = quoteKey(k);
    if (Array.isArray(v) && v.length > 0) {
      const childRendered = emit(v, indent + 1, false);
      const prefix = idx === 0 ? " " : pad;
      return `${prefix}${keyStr}:\n${childRendered}`;
    }
    if (isPlainObject(v) && Object.keys(v as object).length > 0) {
      const childRendered = renderObjectInline(v as Record<string, unknown>, indent + 1);
      const prefix = idx === 0 ? " " : pad;
      return `${prefix}${keyStr}:${childRendered}`;
    }
    const childRendered = emit(v, indent + 1, true);
    const prefix = idx === 0 ? " " : pad;
    return `${prefix}${keyStr}: ${childRendered}`;
  });
  return lines.join("\n");
}

export function toYaml(value: unknown): string {
  if (value === null || value === undefined) return "null\n";
  if (typeof value !== "object") return emit(value, 0, false) + "\n";
  if (Array.isArray(value)) return emit(value, 0, false) + "\n";
  const keys = Object.keys(value as object);
  if (keys.length === 0) return "{}\n";
  // Top-level object: render each top key flush-left.
  const obj = value as Record<string, unknown>;
  const lines = keys.map(k => {
    const keyStr = quoteKey(k);
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0) {
      return `${keyStr}:\n${emit(v, 1, false)}`;
    }
    if (isPlainObject(v) && Object.keys(v as object).length > 0) {
      const inner = renderObjectInline(v as Record<string, unknown>, 1);
      return `${keyStr}:${inner}`;
    }
    return `${keyStr}: ${emit(v, 1, true)}`;
  });
  return lines.join("\n") + "\n";
}
