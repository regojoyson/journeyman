const GLOBAL_PREFIX = "JM_GLOBAL_";
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

let cached: Record<string, string> | null = null;

export function readGlobalSecrets(): Record<string, string> {
  if (cached) return cached;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(GLOBAL_PREFIX) || v == null) continue;
    const name = k.slice(GLOBAL_PREFIX.length);
    if (NAME_RE.test(name)) out[name] = v;
  }
  cached = out;
  return out;
}

export function listGlobalSecretNames(): string[] {
  return Object.keys(readGlobalSecrets()).sort();
}
