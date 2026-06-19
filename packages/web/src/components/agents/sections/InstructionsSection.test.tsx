import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agent } from "@journeyman/core";
import { InstructionsSection } from "./InstructionsSection.tsx";

const agent = {
  instructions: "Fix {{ticketKey}} in {{repo}}",
  inputs: [
    { name: "ticketKey", type: "text", required: false },
    { name: "repo", type: "text", required: false },
  ],
} as unknown as Agent;

describe("InstructionsSection", () => {
  it("lists the detected inputs as chips", () => {
    const html = renderToStaticMarkup(<InstructionsSection a={agent} patch={() => {}} locked={false} />);
    expect(html).toContain("Detected inputs");
    expect(html).toContain("ticketKey");
    expect(html).toContain("repo");
  });
});
