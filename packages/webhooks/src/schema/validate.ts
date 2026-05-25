import { Ajv, type ValidateFunction } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

const addFormats: FormatsPlugin =
  ((addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
    (addFormatsModule as unknown as FormatsPlugin));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const compiled = new WeakMap<object, ValidateFunction>();

function compile(schema: object): ValidateFunction {
  const existing = compiled.get(schema);
  if (existing) return existing;
  const fn = ajv.compile(schema);
  compiled.set(schema, fn);
  return fn;
}

export type ValidatePayloadResult =
  | { ok: true }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export function validatePayload(schema: unknown, payload: unknown): ValidatePayloadResult {
  if (schema === null || typeof schema !== "object") {
    return { ok: true }; // no schema = accept
  }
  const fn = compile(schema as object);
  if (fn(payload)) return { ok: true };
  const errors = (fn.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
  }));
  return { ok: false, errors };
}
