import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG } from "./provider-catalog.ts";

describe("PROVIDER_CATALOG", () => {
  it("includes an opencode coding-cli entry with no static slots (key is model-derived)", () => {
    const oc = PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.slots ?? []).toEqual([]);
  });

  it("has exactly one default per kind", () => {
    const kinds = [...new Set(PROVIDER_CATALOG.map(p => p.kind))];
    for (const k of kinds) {
      expect(PROVIDER_CATALOG.filter(p => p.kind === k && p.isDefault).length).toBe(1);
    }
  });
});
