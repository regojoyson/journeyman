import { describe, it, expect } from "vitest";
import { validateStructured, salvageStructured } from "./structured.ts";

const boolSchema = {
  type: "object",
  properties: { success: { type: "boolean" } },
  required: ["success"],
} as const;

describe("validateStructured", () => {
  it("accepts a conforming object", () => {
    const r = validateStructured({ success: true }, boolSchema);
    expect(r.ok).toBe(true);
  });
  it("rejects wrong type", () => {
    const r = validateStructured({ success: "yes please" }, boolSchema);
    expect(r.ok).toBe(false);
  });
  it("rejects missing required field", () => {
    const r = validateStructured({}, boolSchema);
    expect(r.ok).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(validateStructured("nope", boolSchema).ok).toBe(false);
    expect(validateStructured(undefined, boolSchema).ok).toBe(false);
  });
});

describe("salvageStructured", () => {
  it("extracts an embedded JSON object", () => {
    const out = salvageStructured('Sure! {"success": true} done.', boolSchema);
    expect(out).toEqual({ success: true });
  });
  it("detects a bare boolean for a single boolean field", () => {
    expect(salvageStructured("The answer is false.", boolSchema)).toEqual({ success: false });
  });
  it("returns undefined when nothing usable is present", () => {
    expect(salvageStructured("I cannot help with that.", boolSchema)).toBeUndefined();
  });

  const pathSchema = {
    type: "object",
    properties: { "spec-path": { type: "string" } },
    required: ["spec-path"],
  } as const;

  it("salvages a bare single-line value into a single string field", () => {
    expect(salvageStructured("docs/spec/HireIQ-5.md", pathSchema)).toEqual({ "spec-path": "docs/spec/HireIQ-5.md" });
  });
  it("does NOT dump a multi-line prose summary into a single string field", () => {
    const prose = "Done. Here's the summary:\n\n| Step | Result |\n|---|---|\nSpec file path: `docs/spec/x.md`";
    expect(salvageStructured(prose, pathSchema)).toBeUndefined();
  });
  it("still extracts a clean JSON block even amid prose", () => {
    const text = 'Done!\n```json\n{"spec-path": "docs/spec/x.md"}\n```';
    expect(salvageStructured(text, pathSchema)).toEqual({ "spec-path": "docs/spec/x.md" });
  });
});
