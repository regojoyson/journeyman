import { describe, it, expect } from "vitest";
import { formatPublishError, type PublishError } from "./validate-for-publish.ts";

describe("formatPublishError", () => {
  it("renders code + summary + Why + bulleted Fixes", () => {
    const e: PublishError = {
      code: "cross_branch_input",
      severity: "error",
      message: "Can't use input 'payload' from 'Webhook Wait' (wh1).",
      detail: "They sit on different parallel branches.",
      fixes: ["Remove this input link.", "Read from the Join's output instead."],
      nodeId: "step1",
      nodeLabel: "Return true/false",
    };
    expect(formatPublishError(e)).toBe(
      [
        "[cross_branch_input] Can't use input 'payload' from 'Webhook Wait' (wh1).",
        "Why: They sit on different parallel branches.",
        "Fixes:",
        "  • Remove this input link.",
        "  • Read from the Join's output instead.",
      ].join("\n"),
    );
  });

  it("omits Why and Fixes when absent", () => {
    const e: PublishError = { code: "no_trigger", message: "Flow needs a trigger." };
    expect(formatPublishError(e)).toBe("[no_trigger] Flow needs a trigger.");
  });
});
