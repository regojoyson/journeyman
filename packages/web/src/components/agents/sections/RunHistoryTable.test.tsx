import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { AgentRunEnriched } from "../../../api/agents.ts";
import { RunHistoryTable } from "./RunHistoryTable.tsx";

function run(over: Partial<AgentRunEnriched> = {}): AgentRunEnriched {
  return {
    id: "3f9a1c2b-1111-2222-3333-444455556666",
    status: "completed",
    triggerSource: "manual",
    startedAt: "2020-01-01T00:00:00.000Z",
    completedAt: "2020-01-01T00:01:12.000Z",
    durationMs: 72000,
    inputs: {},
    outputs: null,
    agentId: "a1",
    agentName: "triager",
    provider: "claude",
    model: "claude-opus-4-8",
    ...over,
  };
}

function render(props: Partial<Parameters<typeof RunHistoryTable>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunHistoryTable
        wsId="w1"
        runs={[run()]}
        total={1}
        page={1}
        pageSize={10}
        loading={false}
        onPageChange={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("RunHistoryTable", () => {
  it("renders status, trigger, relative time, duration, and a run link", () => {
    const html = render();
    expect(html).toContain("completed");
    expect(html).toContain("manual");
    expect(html).toContain("days ago");            // fmtRelative of a 2020 date
    expect(html).toContain("1m 12s");              // formatDuration(72000)
    expect(html).toContain("/workspaces/w1/agent-runs/3f9a1c2b-1111-2222-3333-444455556666");
  });

  it("shows the input ref (key + value) in the first column, omitting agentId", () => {
    const html = render({
      runs: [run({ inputs: { agentId: "AGENTID_SENTINEL", issueUrl: "https://example.com/issue/7" } })],
    });
    expect(html).toContain("issueUrl");                          // keyLabel
    expect(html).toContain("https://example.com/issue/7");        // valueText
    expect(html).not.toContain("AGENTID_SENTINEL");              // agentId stripped
  });

  it("falls back to the short run id when there is no input ref", () => {
    const html = render({ runs: [run({ inputs: { agentId: "AGENTID_SENTINEL" } })] });
    expect(html).toContain("3f9a1c2b");            // short id fallback
    expect(html).not.toContain("AGENTID_SENTINEL");
  });

  it("shows the loading state", () => {
    expect(render({ loading: true, runs: [] })).toContain("Loading");
  });

  it("shows the empty state when there are no runs", () => {
    expect(render({ runs: [], total: 0 })).toContain("No runs yet.");
  });

  it("shows a live elapsed duration with an ellipsis for running rows", () => {
    const html = render({ runs: [run({ status: "running", durationMs: null })] });
    expect(html).toContain("…");
  });

  it("renders the pagination footer with range and total", () => {
    const html = render({ total: 37, page: 1, pageSize: 10 });
    expect(html).toContain("1–10 of 37");
  });

  it("disables Prev on the first page and enables Next when more pages exist", () => {
    const html = render({ total: 37, page: 1, pageSize: 10 });
    expect(html).toMatch(/← Prev[^<]*<\/button>/);
    expect(html).toContain("disabled");
  });
});
