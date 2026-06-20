import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Agent, AgentInputField } from "@journeyman/core";
import { RunAgentModal } from "./RunAgentModal.tsx";

const base: Agent = {
  id: "a1", workspaceId: "w1", orgId: "o1", name: "triager",
  instructions: "x", inputs: [], provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: [], tools: [], skillIds: [], repoSelections: [],
  permissions: { allowedTools: [] }, notifications: { on: [] }, outputMode: "text",
  behavior: {}, triggers: [], status: "active", enabled: true,
  createdBy: "u1", createdAt: "2026-06-19T00:00:00Z", updatedAt: "2026-06-19T00:00:00Z",
};

function render(a: Agent) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunAgentModal wsId="w1" agent={a} onClose={() => {}} />
    </MemoryRouter>,
  );
}

const inputs: AgentInputField[] = [
  { name: "issueUrl", type: "text", required: true },
  { name: "notify", type: "boolean", required: false, default: true },
];

describe("RunAgentModal", () => {
  it("renders the title, agent name, and each input field", () => {
    const html = render({ ...base, inputs });
    expect(html).toContain("Run agent");
    expect(html).toContain("triager");
    expect(html).toContain("issueUrl");
    expect(html).toContain("notify");
  });

  it("disables Run while a required field is empty", () => {
    // The Run button renders the `disabled` attribute (as `disabled=""`).
    // Note: the Tailwind class string itself contains "disabled:" variants,
    // so we must assert on the rendered attribute, not the bare substring.
    const html = render({ ...base, inputs });
    expect(html).toContain('disabled=""');
  });

  it("shows a confirmation and an enabled Run button when there are no inputs", () => {
    const html = render({ ...base, inputs: [] });
    expect(html).toContain("takes no inputs");
    expect(html).toContain("triager");
    expect(html).not.toContain('disabled=""');
  });
});
