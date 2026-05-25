import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two strings interpreted as UTF-8.
 * Returns false (without throwing) when lengths differ.
 */
export function constantTimeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Constant-time comparison of two hex- or base64-encoded digests.
 * The two inputs may use different encodings as long as they decode to the
 * same byte length.
 */
export function constantTimeEqualEncoded(
  a: string,
  b: string,
  encoding: "hex" | "base64",
): boolean {
  const ab = Buffer.from(a, encoding);
  const bb = Buffer.from(b, encoding);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
