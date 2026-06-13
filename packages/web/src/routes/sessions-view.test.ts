import { describe, it, expect } from "vitest";
import type { BuilderSession } from "../api/builder.ts";
import { sessionLabel, sessionStatusBadge, orderSessions } from "./sessions-view.ts";

const s = (over: Partial<BuilderSession>): BuilderSession => ({
  id: "1", name: "Build a QA flow", status: "active", messages: [], buildPlan: null, appliedFlowId: null, ...over,
});

describe("sessionLabel", () => {
  it("uses the session name when present", () => {
    expect(sessionLabel(s({ name: "Nightly SRE agent" }))).toBe("Nightly SRE agent");
  });
  it("falls back to the first user message, truncated", () => {
    const long = "a".repeat(80);
    const out = sessionLabel(s({ name: "", messages: [{ role: "user", content: long }] }));
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith("aaaa")).toBe(true);
  });
  it("falls back to 'Untitled build' when nothing is available", () => {
    expect(sessionLabel(s({ name: "", messages: [] }))).toBe("Untitled build");
  });
});

describe("sessionStatusBadge", () => {
  it("maps statuses to a short label", () => {
    expect(sessionStatusBadge(s({ status: "applied" }))).toBe("applied");
    expect(sessionStatusBadge(s({ status: "active" }))).toBe("draft");
    expect(sessionStatusBadge(s({ status: "archived" }))).toBe("archived");
  });
});

describe("orderSessions", () => {
  it("puts active drafts before applied/archived, preserving input order within a group", () => {
    const list = [
      s({ id: "a", status: "applied" }),
      s({ id: "b", status: "active" }),
      s({ id: "c", status: "archived" }),
      s({ id: "d", status: "active" }),
    ];
    expect(orderSessions(list).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
});
