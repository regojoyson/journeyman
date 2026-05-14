import { providersForKind } from "@journeyman/core";

const VALID = new Set(providersForKind("coding-cli").map((p) => p.value));

export const LIST_CODING_PROVIDERS: readonly string[] = [...VALID];

export function isValidCodingProvider(value: unknown): value is string {
  return typeof value === "string" && VALID.has(value);
}
