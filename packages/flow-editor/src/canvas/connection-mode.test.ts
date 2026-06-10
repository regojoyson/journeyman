import { describe, it, expect } from "vitest";
import { ConnectionMode } from "@xyflow/react";
import { CANVAS_CONNECTION_MODE } from "./connection-mode.ts";

describe("CANVAS_CONNECTION_MODE", () => {
  // Regression guard: must stay Strict so the drag preview only snaps to
  // target (left-side input) handles, matching where the dropped edge lands.
  // Loose mode caused the preview to latch onto right-side source handles.
  it("is Strict, not Loose", () => {
    expect(CANVAS_CONNECTION_MODE).toBe(ConnectionMode.Strict);
    expect(CANVAS_CONNECTION_MODE).not.toBe(ConnectionMode.Loose);
  });
});
