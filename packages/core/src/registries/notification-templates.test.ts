import { describe, it, expect } from "vitest";
import { renderNotificationTemplate, NOTIFICATION_PLACEHOLDERS } from "./notification-templates.ts";

const vars = {
  agent: "Nightly Sync",
  status: "completed",
  runId: "wf_8a2c",
  workflow: "Nightly ETL",
  duration: "1m 12s",
  failedNode: "",
};

describe("renderNotificationTemplate", () => {
  it("substitutes each known token", () => {
    expect(renderNotificationTemplate("{agent} {status} {runId} {workflow} {duration}", vars))
      .toBe("Nightly Sync completed wf_8a2c Nightly ETL 1m 12s");
  });

  it("leaves unknown tokens untouched", () => {
    expect(renderNotificationTemplate("hi {nope}", vars)).toBe("hi {nope}");
  });

  it("returns an empty string unchanged", () => {
    expect(renderNotificationTemplate("", vars)).toBe("");
  });

  it("substitutes empty-valued tokens with empty string", () => {
    expect(renderNotificationTemplate("at {failedNode}.", vars)).toBe("at .");
  });

  it("every declared placeholder token resolves against a vars key", () => {
    for (const p of NOTIFICATION_PLACEHOLDERS) {
      const key = p.token.slice(1, -1);
      expect(key in vars).toBe(true);
    }
  });
});
