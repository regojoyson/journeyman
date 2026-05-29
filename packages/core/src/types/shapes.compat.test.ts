import { describe, it, expect } from "vitest";
import { shapesEqual, shapesCompatible } from "./shapes.ts";
import type { Shape } from "./shape.types.ts";

const jsonObj: Shape = { type: "json", container: "object" };
const jsonArr: Shape = { type: "json", container: "array" };
const emptyObj: Shape = { type: "object", fields: {} };
const typedObj: Shape = { type: "object", fields: { a: { type: "string" } } };
const strArr: Shape = { type: "array", items: { type: "string" } };
const str: Shape = { type: "string" };

describe("shapesEqual — json", () => {
  it("equal json objects match", () => {
    expect(shapesEqual(jsonObj, { type: "json", container: "object" })).toBe(true);
  });
  it("json object != json array", () => {
    expect(shapesEqual(jsonObj, jsonArr)).toBe(false);
  });
  it("json object != typed object", () => {
    expect(shapesEqual(jsonObj, typedObj)).toBe(false);
  });
});

describe("shapesCompatible — json", () => {
  it("json object binds to json object", () => {
    expect(shapesCompatible(jsonObj, jsonObj)).toBe(true);
  });
  it("json object binds to typed object (both directions)", () => {
    expect(shapesCompatible(jsonObj, typedObj)).toBe(true);
    expect(shapesCompatible(typedObj, jsonObj)).toBe(true);
  });
  it("json object binds to empty/wildcard object", () => {
    expect(shapesCompatible(jsonObj, emptyObj)).toBe(true);
    expect(shapesCompatible(emptyObj, jsonObj)).toBe(true);
  });
  it("json array binds to json array and typed array", () => {
    expect(shapesCompatible(jsonArr, jsonArr)).toBe(true);
    expect(shapesCompatible(jsonArr, strArr)).toBe(true);
  });
  it("json object does NOT bind to a scalar", () => {
    expect(shapesCompatible(jsonObj, str)).toBe(false);
  });
  it("json object does NOT bind to json array", () => {
    expect(shapesCompatible(jsonObj, jsonArr)).toBe(false);
  });
  it("typed object still strictly matches identical typed object", () => {
    expect(shapesCompatible(typedObj, { type: "object", fields: { a: { type: "string" } } })).toBe(true);
  });
});
