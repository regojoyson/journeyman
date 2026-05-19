import { redactString } from "./redact.ts";

export interface SerializedError {
  errorClass: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError;
}

const MAX_DEPTH = 3;

export function serializeError(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const out: SerializedError = {
      errorClass: err.name || "Error",
      message: redactString(err.message ?? ""),
    };
    if (err.stack) out.stack = redactString(err.stack);
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") out.code = code;
    const cause = (err as { cause?: unknown }).cause;
    if (cause && depth < MAX_DEPTH) {
      out.cause = serializeError(cause, depth + 1);
    }
    return out;
  }
  if (typeof err === "string") {
    return { errorClass: "Unknown", message: redactString(err) };
  }
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown };
    return {
      errorClass: "Unknown",
      message: redactString(String(o.message ?? "")),
      ...(typeof o.code === "string" ? { code: o.code } : {}),
    };
  }
  return { errorClass: "Unknown", message: String(err) };
}
