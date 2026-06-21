import { describe, it, expect } from "vitest";
import { getByPath } from "./jsonpath.ts";

describe("getByPath", () => {
  const payload = {
    action: "created",
    issue: { number: 8, title: "Bug" },
    comment: { body: "hi" },
    items: [{ name: "a" }, { name: "b" }],
  };

  it("resolves a JSONPath-rooted path ($.issue.number) — the form stored as correlation_event_path", () => {
    expect(getByPath(payload, "$.issue.number")).toBe(8);
  });

  it("returns the whole object for the root path ($) — the form used by output fromPath", () => {
    expect(getByPath(payload, "$")).toBe(payload);
  });

  it("still resolves bare dot paths (no $ prefix)", () => {
    expect(getByPath(payload, "issue.number")).toBe(8);
    expect(getByPath(payload, "comment.body")).toBe("hi");
  });

  it("still resolves array index paths", () => {
    expect(getByPath(payload, "$.items[1].name")).toBe("b");
    expect(getByPath(payload, "items[0].name")).toBe("a");
  });

  it("returns null for missing segments", () => {
    expect(getByPath(payload, "$.issue.missing")).toBeNull();
    expect(getByPath(null, "$.a")).toBeNull();
  });
});
