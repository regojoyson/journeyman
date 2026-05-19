import { describe, it, expect } from "vitest";
import {
  CUSTOM_PHASE_ICON_NAMES,
  DEFAULT_CUSTOM_PHASE_ICON_ID,
  isValidCustomPhaseIcon,
} from "./custom-phase-icons.ts";

describe("custom-phase-icons", () => {
  it("ships a non-empty curated list", () => {
    expect(CUSTOM_PHASE_ICON_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(CUSTOM_PHASE_ICON_NAMES.length).toBeLessThanOrEqual(60);
  });

  it("contains no duplicates", () => {
    const set = new Set(CUSTOM_PHASE_ICON_NAMES);
    expect(set.size).toBe(CUSTOM_PHASE_ICON_NAMES.length);
  });

  it("default is in the allowlist", () => {
    const name = DEFAULT_CUSTOM_PHASE_ICON_ID.replace(/^lucide:/, "");
    expect(CUSTOM_PHASE_ICON_NAMES).toContain(name);
  });

  it("accepts null and undefined as 'use default'", () => {
    expect(isValidCustomPhaseIcon(null)).toBe(true);
    expect(isValidCustomPhaseIcon(undefined)).toBe(true);
  });

  it("accepts a lucide id from the allowlist", () => {
    expect(isValidCustomPhaseIcon(`lucide:${CUSTOM_PHASE_ICON_NAMES[0]}`)).toBe(true);
  });

  it("rejects an unknown lucide name", () => {
    expect(isValidCustomPhaseIcon("lucide:NotARealIconName_xyz")).toBe(false);
  });

  it("rejects a non-string non-null value", () => {
    expect(isValidCustomPhaseIcon(42)).toBe(false);
    expect(isValidCustomPhaseIcon({})).toBe(false);
  });

  it("rejects an unknown scheme", () => {
    expect(isValidCustomPhaseIcon("emoji:🚀")).toBe(false);
    expect(isValidCustomPhaseIcon("http://example.com/x.png")).toBe(false);
  });

  it("rejects data: URLs for now (uploads not yet supported)", () => {
    expect(isValidCustomPhaseIcon("data:image/png;base64,aaaa")).toBe(false);
  });
});
