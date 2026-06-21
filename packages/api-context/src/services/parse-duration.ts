const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
type Unit = keyof typeof UNIT_MS;

export function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  return Number(m[1]) * UNIT_MS[m[2] as Unit];
}
