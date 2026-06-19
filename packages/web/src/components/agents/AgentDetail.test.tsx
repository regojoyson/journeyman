import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Agent } from "@journeyman/core";
import { AgentDetail } from "./AgentDetail.tsx";

const agent: Agent = {
  id: "a1", workspaceId: "w1", orgId: "o1", name: "nightly-triager",
  instructions: "x", inputs: [], provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: [], tools: [], skillIds: [], repoSelections: [],
  permissions: { allowedTools: [] }, notifications: { on: [] }, outputMode: "text",
  behavior: {}, triggers: [], status: "draft", enabled: false,
  createdBy: "u1", createdAt: "2026-06-19T00:00:00Z", updatedAt: "2026-06-19T00:00:00Z",
};

function render(a: Agent) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AgentDetail wsId="w1" orgId="o1" initial={a} />
    </MemoryRouter>,
  );
}

describe("AgentDetail", () => {
  it("shows the agent name and status badge", () => {
    const html = render(agent);
    expect(html).toContain("nightly-triager");
    expect(html).toContain("DRAFT");
  });
  it("renders the instructions section by default", () => {
    // renderToStaticMarkup HTML-escapes "&" → "&amp;"
    expect(render(agent)).toContain("Instructions &amp; Inputs");
  });
  it("shows the lock banner when enabled", () => {
    const html = render({ ...agent, enabled: true });
    expect(html).toContain("ENABLED");
    expect(html).toContain("disable to edit");
  });
});
