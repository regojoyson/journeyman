/** Tokens that are special, not user inputs. {{trigger.type}} is naturally
 *  excluded because the matcher only accepts word characters (no dot). */
const RESERVED = new Set(["payload"]);

/** Extract the ordered, de-duplicated list of {{input}} names from a prompt. */
export function detectInputs(instructions: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(instructions)) !== null) {
    const name = m[1];
    if (RESERVED.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
