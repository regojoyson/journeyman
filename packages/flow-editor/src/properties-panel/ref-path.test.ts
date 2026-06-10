import { describe, it, expect } from "vitest";
import { splitRefPath, joinRefPath, validatePathTail } from "./ref-path.ts";
import type { MentionField } from "./mention-fields.ts";

const fields: MentionField[] = [
  { ref: "wh.output.payload", sourceId: "wh", sourceLabel: "Webhook", showId: false, fieldPath: "output.payload", type: "json object", drillable: true, shape: { type: "json", container: "object" } },
  { ref: "list.output.prs", sourceId: "list", sourceLabel: "Lister", showId: false, fieldPath: "output.prs", type: "array", drillable: true, shape: { type: "array", items: { type: "string" } } },
];

describe("splitRefPath", () => {
  it("splits a drilled ref into base + tail", () => {
    expect(splitRefPath("wh.output.payload.user.name", fields)).toEqual({ baseRef: "wh.output.payload", tail: ".user.name" });
    expect(splitRefPath("list.output.prs[0].title", fields)).toEqual({ baseRef: "list.output.prs", tail: "[0].title" });
  });
  it("returns empty tail when the ref is exactly a base field", () => {
    expect(splitRefPath("wh.output.payload", fields)).toEqual({ baseRef: "wh.output.payload", tail: "" });
  });
  it("falls back to the whole ref as base when nothing matches", () => {
    expect(splitRefPath("unknown.output.x", fields)).toEqual({ baseRef: "unknown.output.x", tail: "" });
  });
});

describe("joinRefPath", () => {
  it("concatenates base and tail", () => {
    expect(joinRefPath("wh.output.payload", ".user.name")).toBe("wh.output.payload.user.name");
    expect(joinRefPath("list.output.prs", "[0].title")).toBe("list.output.prs[0].title");
    expect(joinRefPath("wh.output.payload", "")).toBe("wh.output.payload");
  });
});

describe("validatePathTail", () => {
  it("accepts empty, dotted, indexed, wildcard tails", () => {
    expect(validatePathTail("").ok).toBe(true);
    expect(validatePathTail(".user.name").ok).toBe(true);
    expect(validatePathTail("[0].title").ok).toBe(true);
    expect(validatePathTail("[*].title").ok).toBe(true);
    expect(validatePathTail(".items[0].tags[*]").ok).toBe(true);
  });
  it("rejects tails that do not start with . or [", () => {
    expect(validatePathTail("user.name").ok).toBe(false);
  });
  it("rejects malformed brackets", () => {
    expect(validatePathTail("[abc]").ok).toBe(false);
    expect(validatePathTail(".a[").ok).toBe(false);
  });
});
