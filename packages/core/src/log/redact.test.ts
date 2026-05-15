import { describe, it, expect } from "vitest";
import { redactString, redactObject } from "./redact.ts";

describe("redactString", () => {
  it("redacts token-like values from a string", () => {
    expect(redactString("Authorization: Bearer abc123def")).toBe("Authorization: Bearer [REDACTED]");
    expect(redactString('token="xyz"')).toBe("token=[REDACTED]");
    expect(redactString("password=p@ss")).toBe("password=[REDACTED]");
  });
  it("returns non-matching strings unchanged", () => {
    expect(redactString("hello world")).toBe("hello world");
  });
});

describe("redactObject", () => {
  it("redacts values for sensitive keys recursively", () => {
    const input = {
      ok: "value",
      token: "abc",
      nested: { secret: "shh", deeper: { apiKey: "k" } },
      arr: [{ password: "p" }],
    };
    expect(redactObject(input)).toEqual({
      ok: "value",
      token: "[REDACTED]",
      nested: { secret: "[REDACTED]", deeper: { apiKey: "[REDACTED]" } },
      arr: [{ password: "[REDACTED]" }],
    });
  });
  it("handles null and primitive inputs", () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject("plain")).toBe("plain");
  });
});
