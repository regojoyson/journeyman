import { describe, it, expect } from "vitest";
import { NOTIFICATION_SCAFFOLDS } from "./notification-scaffolds.ts";

describe("NOTIFICATION_SCAFFOLDS", () => {
  it("each scaffold has non-empty id/label/subject/body", () => {
    for (const s of NOTIFICATION_SCAFFOLDS) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.subject.trim()).toBeTruthy();
      expect(s.body.trim()).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    const ids = NOTIFICATION_SCAFFOLDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contain no agent-style {placeholder} tokens (the step has no renderer)", () => {
    for (const s of NOTIFICATION_SCAFFOLDS) {
      expect(`${s.subject} ${s.body}`).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
