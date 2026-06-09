import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG, providersForKind } from "./provider-catalog.ts";

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

describe("opencode provider slots", () => {
  it("advertises the common cloud-provider key slots so they are bindable", () => {
    const opencode = providersForKind("coding-cli").find((p) => p.value === "opencode")!;
    const names = (opencode.slots ?? []).map((s) => s.name);
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]) {
      expect(names, `missing slot ${k}`).toContain(k);
    }
  });
  it("keeps all opencode slots optional", () => {
    const opencode = providersForKind("coding-cli").find((p) => p.value === "opencode")!;
    expect((opencode.slots ?? []).every((s) => s.optional)).toBe(true);
  });
});
