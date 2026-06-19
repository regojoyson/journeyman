import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agent } from "@journeyman/core";
import { TriggersSection } from "./TriggersSection.tsx";

const agent = {
  id: "a1",
  inputs: [{ name: "ticketKey", type: "text", required: false }],
  triggers: [
    { type: "webhook", webhookId: "wh1", inputsMapping: { ticketKey: "$.issue.key" } },
    { type: "schedule", cron: "0 2 * * *", timezone: "UTC", fixedInputs: { ticketKey: "PROJ-1" } },
  ],
} as unknown as Agent;

describe("TriggersSection", () => {
  it("renders a webhook path row and a schedule value row per input", () => {
    const html = renderToStaticMarkup(
      <TriggersSection a={agent} patch={() => {}} locked={false} wsId="w1" />,
    );
    expect(html).toContain("ticketKey");
    expect(html).toContain("$.issue.key"); // webhook path value
    expect(html).toContain("PROJ-1"); // schedule fixed value
  });
});
