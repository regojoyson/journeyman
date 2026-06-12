import { describe, it, expect } from "vitest";
import { friendlyRef, humanizeTemplate, summaryValue } from "./step-definition.ts";

describe("friendlyRef", () => {
  it("strips scope prefixes and prefixes with @", () => {
    expect(friendlyRef("workflow.input.ticketOwner")).toBe("@ticketOwner");
    expect(friendlyRef("workflow.attribute.branchPrefix")).toBe("@branchPrefix");
    expect(friendlyRef("list.output.pullRequests")).toBe("@pullRequests");
  });
  it("keeps the path tail intact", () => {
    expect(friendlyRef("wh.output.payload.user.name")).toBe("@payload.user.name");
    expect(friendlyRef("list.output.prs[0].title")).toBe("@prs[0].title");
  });
  it("falls back to the raw ref for unrecognized shapes", () => {
    expect(friendlyRef("weird")).toBe("@weird");
    expect(friendlyRef("")).toBe("");
  });
});

describe("humanizeTemplate", () => {
  it("rewrites every ${ref} into a friendly token, keeping literals", () => {
    expect(humanizeTemplate("${workflow.input.ticketOwner}/${workflow.input.ticketId}"))
      .toBe("@ticketOwner/@ticketId");
    expect(humanizeTemplate("PR-${list.output.prs[0].title}")).toBe("PR-@prs[0].title");
  });
  it("leaves plain text unchanged", () => {
    expect(humanizeTemplate("just text")).toBe("just text");
  });
});

describe("summaryValue", () => {
  it("humanizes a template stored in config", () => {
    const cfg = { ref: "${workflow.input.ticketOwner}/${workflow.input.ticketId}" };
    expect(summaryValue(cfg, undefined, "ref")).toBe("@ticketOwner/@ticketId");
  });
  it("humanizes a sole-ref binding from inputs", () => {
    const ctx = { inputs: { ref: { kind: "ref" as const, ref: "list.output.pullRequests[0].title" } } };
    expect(summaryValue({}, ctx as never, "ref")).toBe("@pullRequests[0].title");
  });
  it("returns empty when nothing is set", () => {
    expect(summaryValue({}, undefined, "ref")).toBe("");
  });
});
