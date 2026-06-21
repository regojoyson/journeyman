import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowInstanceStatus } from "@journeyman/core";
import { AgentRunControls } from "./AgentRunControls.tsx";

const noop = () => {};
const base = {
  busy: false,
  canWrite: true,
  onPause: noop,
  onResume: noop,
  onCancel: noop,
  onRerun: noop,
};

function html(status: WorkflowInstanceStatus, over: Partial<typeof base> = {}) {
  return renderToStaticMarkup(<AgentRunControls status={status} {...base} {...over} />);
}

describe("AgentRunControls", () => {
  it("running → Pause + Cancel, no Resume/Re-run", () => {
    const h = html("running");
    expect(h).toContain("Pause");
    expect(h).toContain("Cancel");
    expect(h).not.toContain("Resume");
    expect(h).not.toContain("Re-run");
  });

  it("paused → Resume + Cancel, no Pause/Re-run", () => {
    const h = html("paused");
    expect(h).toContain("Resume");
    expect(h).toContain("Cancel");
    expect(h).not.toContain("Pause");
    expect(h).not.toContain("Re-run");
  });

  it("terminal (completed) → Re-run only, no Cancel/Pause/Resume", () => {
    const h = html("completed");
    expect(h).toContain("Re-run");
    expect(h).not.toContain("Cancel");
    expect(h).not.toContain("Pause");
    expect(h).not.toContain("Resume");
  });

  it("terminal (failed) → Re-run", () => {
    expect(html("failed")).toContain("Re-run");
  });

  it("cancelled is terminal → Re-run", () => {
    expect(html("cancelled")).toContain("Re-run");
  });

  it("renders nothing for viewers (canWrite=false)", () => {
    expect(html("running", { canWrite: false })).toBe("");
  });

  it("disables buttons while busy", () => {
    expect(html("running", { busy: true })).toContain("disabled");
  });
});
