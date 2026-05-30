import { describe, it, expect } from "vitest";
import { validateField } from "./NodeDetailDrawer.tsx";

const f = (type: "string" | "number" | "boolean" | "json" | "date", required = false) =>
  ({ name: "x", label: "X", type, required });

describe("validateField", () => {
  it("required + empty → error; optional + empty → ok", () => {
    expect(validateField(f("string", true), "")).toBe("X is required");
    expect(validateField(f("string", true), "   ")).toBe("X is required");
    expect(validateField(f("json", true), undefined)).toBe("X is required");
    expect(validateField(f("string", false), "")).toBeNull();
  });

  it("number must be numeric", () => {
    expect(validateField(f("number"), "42")).toBeNull();
    expect(validateField(f("number"), "3.14")).toBeNull();
    expect(validateField(f("number"), "abc")).toBe("X must be a number");
  });

  it("json must parse", () => {
    expect(validateField(f("json"), '{"a":1}')).toBeNull();
    expect(validateField(f("json"), "[1,2,3]")).toBeNull();
    expect(validateField(f("json"), "{not json}")).toBe("X must be valid JSON");
  });

  it("date must be parseable", () => {
    expect(validateField(f("date"), "2026-05-30")).toBeNull();
    expect(validateField(f("date"), "not-a-date")).toBe("X must be a valid date");
  });

  it("string and boolean accept any non-empty value", () => {
    expect(validateField(f("string"), "anything")).toBeNull();
    expect(validateField(f("boolean"), "true")).toBeNull();
  });
});
