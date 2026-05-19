import { describe, it, expect } from "vitest";
import {
  CUSTOM_STEP_ICON_NAMES,
  DEFAULT_CUSTOM_STEP_ICON_ID,
  isValidCustomStepIcon,
} from "./custom-step-icons.ts";

describe("custom-step-icons", () => {
  it("ships a non-empty curated list", () => {
    expect(CUSTOM_STEP_ICON_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(CUSTOM_STEP_ICON_NAMES.length).toBeLessThanOrEqual(60);
  });

  it("contains no duplicates", () => {
    const set = new Set(CUSTOM_STEP_ICON_NAMES);
    expect(set.size).toBe(CUSTOM_STEP_ICON_NAMES.length);
  });

  it("default is in the allowlist", () => {
    const name = DEFAULT_CUSTOM_STEP_ICON_ID.replace(/^lucide:/, "");
    expect(CUSTOM_STEP_ICON_NAMES).toContain(name);
  });

  it("accepts null and undefined as 'use default'", () => {
    expect(isValidCustomStepIcon(null)).toBe(true);
    expect(isValidCustomStepIcon(undefined)).toBe(true);
  });

  it("accepts a lucide id from the allowlist", () => {
    expect(isValidCustomStepIcon(`lucide:${CUSTOM_STEP_ICON_NAMES[0]}`)).toBe(true);
  });

  it("rejects an unknown lucide name", () => {
    expect(isValidCustomStepIcon("lucide:NotARealIconName_xyz")).toBe(false);
  });

  it("rejects a non-string non-null value", () => {
    expect(isValidCustomStepIcon(42)).toBe(false);
    expect(isValidCustomStepIcon({})).toBe(false);
  });

  it("rejects an unknown scheme", () => {
    expect(isValidCustomStepIcon("emoji:🚀")).toBe(false);
    expect(isValidCustomStepIcon("http://example.com/x.png")).toBe(false);
  });

  it("rejects data: URLs for now (uploads not yet supported)", () => {
    expect(isValidCustomStepIcon("data:image/png;base64,aaaa")).toBe(false);
  });
});
