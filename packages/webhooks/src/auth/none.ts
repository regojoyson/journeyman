import type { VerifyInput, VerifyResult } from "./verify.ts";

export function verifyNone(_input: VerifyInput): VerifyResult {
  return { ok: true };
}
