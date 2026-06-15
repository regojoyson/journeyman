import { describe, it, expect } from "vitest";
import { clampChatWidth } from "./builder-layout.ts";

describe("clampChatWidth", () => {
  it("returns the desired width when within range", () => {
    expect(clampChatWidth(600, 1400)).toBe(600);
  });
  it("clamps up to the minimum when too small", () => {
    expect(clampChatWidth(100, 1400)).toBe(320);
  });
  it("clamps down so the right pane keeps its reserved space", () => {
    // max = containerWidth - reserveRight(360) = 1000 - 360 = 640
    expect(clampChatWidth(900, 1000)).toBe(640);
  });
  it("never returns below the minimum even in a tiny container", () => {
    expect(clampChatWidth(500, 400)).toBe(320);
  });
  it("honors custom min / reserveRight", () => {
    expect(clampChatWidth(50, 1200, { min: 280, reserveRight: 400 })).toBe(280);
    expect(clampChatWidth(2000, 1200, { min: 280, reserveRight: 400 })).toBe(800);
  });
});
