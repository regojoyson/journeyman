import { Ajv } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

// ajv-formats is CJS — the default export may be on `.default` under NodeNext.
const addFormats: FormatsPlugin =
  ((addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
    (addFormatsModule as unknown as FormatsPlugin));

let cached: Ajv | null = null;

function getAjv(): Ajv {
  if (!cached) {
    cached = new Ajv({ allErrors: true, strict: false });
    addFormats(cached);
  }
  return cached;
}

export type LintResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Confirms the given document is itself a valid JSON Schema by compiling it.
 * Catches malformed `type`, unresolved `$ref`, etc.
 */
export function lintJsonSchema(schema: unknown): LintResult {
  try {
    getAjv().compile(schema as object);
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}
