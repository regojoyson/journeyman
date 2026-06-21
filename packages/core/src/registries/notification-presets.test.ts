import { describe, it, expect } from "vitest";
import { NOTIFICATION_PRESETS } from "./notification-presets.ts";
import { NOTIFICATION_PLACEHOLDERS } from "./notification-templates.ts";

const KNOWN = new Set(NOTIFICATION_PLACEHOLDERS.map((p) => p.token));

describe("NOTIFICATION_PRESETS", () => {
  it("has unique ids", () => {
    const ids = NOTIFICATION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every {token} used is a known placeholder", () => {
    for (const p of NOTIFICATION_PRESETS) {
      const text = [p.success.subject, p.success.body, p.failure.subject, p.failure.body].join(" ");
      for (const m of text.matchAll(/\{[a-zA-Z]+\}/g)) {
        expect(KNOWN.has(m[0])).toBe(true);
      }
    }
  });

  it("every outcome has non-empty subject and body", () => {
    for (const p of NOTIFICATION_PRESETS) {
      for (const o of [p.success, p.failure]) {
        expect(o.subject.trim()).toBeTruthy();
        expect(o.body.trim()).toBeTruthy();
      }
    }
  });
});
