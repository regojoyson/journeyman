import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG } from "./provider-catalog.ts";

describe("PROVIDER_CATALOG", () => {
  it("includes an opencode coding-cli entry with its key slot", () => {
    const oc = PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.slots?.some(s => s.name === "OPENCODE_API_KEY")).toBe(true);
  });

  it("has exactly one default per kind", () => {
    const kinds = [...new Set(PROVIDER_CATALOG.map(p => p.kind))];
    for (const k of kinds) {
      expect(PROVIDER_CATALOG.filter(p => p.kind === k && p.isDefault).length).toBe(1);
    }
  });
});
