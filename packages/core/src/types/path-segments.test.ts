import { describe, it, expect } from "vitest";
import { parsePathSegments, shapeAtPathSegs } from "./path-segments.ts";
import { shapeAtPath } from "./shapes.ts";
import type { Shape } from "./shape.types.ts";

describe("parsePathSegments", () => {
  it("parses dotted object paths", () => {
    expect(parsePathSegments("payload.user.name")).toEqual([
      { kind: "key", key: "payload" }, { kind: "key", key: "user" }, { kind: "key", key: "name" },
    ]);
  });
  it("parses index and wildcard", () => {
    expect(parsePathSegments("items[0].title")).toEqual([
      { kind: "key", key: "items" }, { kind: "index", index: 0 }, { kind: "key", key: "title" },
    ]);
    expect(parsePathSegments("items[*].title")).toEqual([
      { kind: "key", key: "items" }, { kind: "wildcard" }, { kind: "key", key: "title" },
    ]);
  });
  it("parses a leading bracket tail", () => {
    expect(parsePathSegments("[0].title")).toEqual([
      { kind: "index", index: 0 }, { kind: "key", key: "title" },
    ]);
  });
  it("empty string is an empty path", () => {
    expect(parsePathSegments("")).toEqual([]);
  });
  it("rejects malformed brackets and empty keys", () => {
    expect(parsePathSegments("items[abc]")).toBeNull();
    expect(parsePathSegments("items[")).toBeNull();
    expect(parsePathSegments("items[].x")).toBeNull();
    expect(parsePathSegments("a..b")).toBeNull();
  });
  it("tolerates a leading separator so path TAILS parse", () => {
    // The editor parses tails like ".user.name" — a leading '.' is a separator,
    // not an error. (Validators always pass a full field starting with a key.)
    expect(parsePathSegments(".user.name")).toEqual([
      { kind: "key", key: "user" }, { kind: "key", key: "name" },
    ]);
  });
});

const arrOfObj: Shape = { type: "array", items: { type: "object", fields: { title: { type: "string" } } } };
const jsonObj: Shape = { type: "json", container: "object" };
const jsonArr: Shape = { type: "json", container: "array" };
const typedObj: Shape = { type: "object", fields: { user: { type: "object", fields: { name: { type: "string" } } } } };

describe("shapeAtPathSegs", () => {
  it("empty path returns the root", () => {
    expect(shapeAtPathSegs(typedObj, [])).toEqual(typedObj);
  });
  it("walks typed object fields", () => {
    expect(shapeAtPathSegs(typedObj, parsePathSegments("user.name")!)).toEqual({ type: "string" });
  });
  it("index unwraps a typed array to its item field", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("[0].title")!)).toEqual({ type: "string" });
  });
  it("wildcard projects a typed-array field into an array", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("[*].title")!)).toEqual({
      type: "array", items: { type: "string" },
    });
  });
  it("descending past opaque json yields opaque json", () => {
    expect(shapeAtPathSegs(jsonObj, parsePathSegments("anything.deep")!)).toEqual(jsonObj);
    expect(shapeAtPathSegs(jsonArr, parsePathSegments("[0].x")!)).toEqual(jsonArr);
  });
  it("rejects a key applied to an array (no index/wildcard)", () => {
    expect(shapeAtPathSegs(arrOfObj, parsePathSegments("title")!)).toBeNull();
  });
  it("rejects an index applied to an object", () => {
    expect(shapeAtPathSegs(typedObj, parsePathSegments("[0]")!)).toBeNull();
  });
});

describe("shapeAtPath (backward-compat wrapper)", () => {
  it("handles bracketed array elements in the path array", () => {
    expect(shapeAtPath(arrOfObj, ["[0]", "title"])).toEqual({ type: "string" });
    expect(shapeAtPath(arrOfObj, ["[*]", "title"])).toEqual({ type: "array", items: { type: "string" } });
  });
  it("descends past json", () => {
    expect(shapeAtPath(jsonObj, ["a", "b"])).toEqual(jsonObj);
  });
  it("empty path returns root", () => {
    expect(shapeAtPath(typedObj, [])).toEqual(typedObj);
  });
});
