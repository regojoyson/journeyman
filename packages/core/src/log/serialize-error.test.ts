import { describe, it, expect } from "vitest";
import { serializeError } from "./serialize-error.ts";

describe("serializeError", () => {
  it("captures errorClass, message, stack", () => {
    const e = new TypeError("boom");
    const r = serializeError(e);
    expect(r.errorClass).toBe("TypeError");
    expect(r.message).toBe("boom");
    expect(r.stack).toMatch(/TypeError: boom/);
  });

  it("walks cause chain up to 3 levels", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    const r = serializeError(top);
    expect(r.cause?.message).toBe("mid");
    expect(r.cause?.cause?.message).toBe("root");
    expect(r.cause?.cause?.cause).toBeUndefined();
  });

  it("redacts sensitive content in message and stack", () => {
    const e = new Error("token=abc123");
    const r = serializeError(e);
    expect(r.message).toBe("token=[REDACTED]");
  });

  it("handles non-Error throwables", () => {
    expect(serializeError("string thrown")).toEqual({
      errorClass: "Unknown",
      message: "string thrown",
    });
    expect(serializeError({ message: "weird", code: "E_X" })).toMatchObject({
      errorClass: "Unknown",
      message: "weird",
      code: "E_X",
    });
  });
});
