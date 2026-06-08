import { INPUT_TOKEN, SLOT_TOKEN } from "./prompt-tokens.ts";

export const TOKEN_CLASS = {
  input: "cm-token-input",
  slot: "cm-token-slot",
  unknown: "cm-token-unknown",
} as const;

export interface TokenRange {
  from: number;
  to: number;
  cls: string;
}

/** All token match ranges in `text`, sorted by start. Offsets are relative to `text`. */
export function tokenRanges(
  text: string,
  inputNames: Set<string>,
  slotNames: Set<string>,
): TokenRange[] {
  const ranges: TokenRange[] = [];

  for (const m of text.matchAll(INPUT_TOKEN)) {
    const from = m.index!;
    ranges.push({
      from,
      to: from + m[0].length,
      cls: inputNames.has(m[1]) ? TOKEN_CLASS.input : TOKEN_CLASS.unknown,
    });
  }
  for (const m of text.matchAll(SLOT_TOKEN)) {
    const lead = m[1] ?? "";
    const from = m.index! + lead.length;
    ranges.push({
      from,
      to: from + (m[0].length - lead.length),
      cls: slotNames.has(m[2]) ? TOKEN_CLASS.slot : TOKEN_CLASS.unknown,
    });
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return ranges;
}
