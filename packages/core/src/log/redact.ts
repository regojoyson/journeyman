const SENSITIVE_KEY = /token|secret|key|password|authorization/i;
const SENSITIVE_VALUE = /(authorization\s*[:=]\s*bearer\s+)\S+|(\b(?:token|secret|key|password|authorization)\b\s*[:=]\s*)"?[^"\s,;]+"?/gi;

export function redactString(s: string): string {
  return s.replace(SENSITIVE_VALUE, (_m, p1, p2) => `${p1 ?? p2}[REDACTED]`);
}

export function redactObject<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return (typeof value === "string" ? (redactString(value) as unknown as T) : value);
  }
  if (Array.isArray(value)) {
    return value.map(redactObject) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactObject(v);
    }
  }
  return out as T;
}
