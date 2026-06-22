import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow, UsageWaste } from "@journeyman/core";
import { UsageDashboard } from "./UsageDashboard.tsx";

const summary: UsageSummary = {
  rows: 10, inputTokens: 90_000, outputTokens: 30_000, cacheReadTokens: 20_000,
  cacheCreationTokens: 1_200, reasoningTokens: 100, totalTokens: 141_300,
  costUsd: 0.21, unpricedRows: 0, runs: 4, costPerRun: 0.05,
  cacheReadHitRatio: 0.49, cacheSavingsUsd: 0.03,
  previous: {
    rows: 8, inputTokens: 70_000, outputTokens: 20_000, cacheReadTokens: 10_000,
    cacheCreationTokens: 1_000, reasoningTokens: 0, totalTokens: 101_000,
    costUsd: 0.18, unpricedRows: 0, runs: 3,
  },
};
const timeseries: UsageTimeseriesPoint[] = [
  { day: "2026-06-20", costUsd: 0.05, totalTokens: 40_000 },
  { day: "2026-06-21", costUsd: 0.07, totalTokens: 50_000 },
  { day: "2026-06-22", costUsd: 0.09, totalTokens: 51_300 },
];
const breakdown: UsageBreakdownRow[] = [
  { key: "minimax", label: "MiniMax-M3", costUsd: 0.21, totalTokens: 141_300, runs: 4, costPerRun: 0.05, cacheReadHitRatio: 0.49, firstSeen: "2026-06-20" },
];

function render() {
  return renderToStaticMarkup(
    <UsageDashboard
      window="30d" onWindowChange={() => {}}
      groupBy="model" onGroupByChange={() => {}}
      summary={summary} timeseries={timeseries} breakdown={breakdown}
      waste={null} workspaceName="Cadmium"
    />,
  );
}

describe("UsageDashboard render", () => {
  const html = render();

  it("renders all five spend charts", () => {
    expect(html).toContain("Cost over time");
    expect(html).toContain("Cumulative spend");
    expect(html).toContain("Cost by model");
    expect(html).toContain("Cost share");
    expect(html).toContain("Cost per run by model");
  });

  it("renders the usage charts", () => {
    expect(html).toContain("Tokens over time");
    expect(html).toContain("Token mix");
  });

  it("shows the Spend and Usage section labels", () => {
    expect(html).toContain("Spend");
    expect(html).toContain("Usage");
  });

  it("no longer renders the run drill-in", () => {
    expect(html).not.toContain("Drill into a run");
    expect(html).not.toContain("workflow instance id");
  });
});

function renderWithWaste(waste: UsageWaste) {
  return renderToStaticMarkup(
    <UsageDashboard
      window="30d" onWindowChange={() => {}}
      groupBy="model" onGroupByChange={() => {}}
      summary={summary} timeseries={timeseries} breakdown={breakdown}
      waste={waste} workspaceName="Cadmium"
    />,
  );
}

describe("UsageDashboard waste caveat", () => {
  it("shows the caveat and renders the card even when costUsd is null", () => {
    const html = renderWithWaste({
      costUsd: null, totalTokens: 0, rows: 0, fractionOfTotalCost: null, topAgent: null, failedRunsNoCost: 8,
    });
    expect(html).toContain("Wasted spend");
    expect(html).toContain("$0.00");
    expect(html).toContain("8 more run");
    expect(html).toContain("no AI cost recorded");
  });

  it("hides the card when there is neither cost nor failed runs", () => {
    const html = renderWithWaste({
      costUsd: null, totalTokens: 0, rows: 0, fractionOfTotalCost: null, topAgent: null, failedRunsNoCost: 0,
    });
    expect(html).not.toContain("Wasted spend");
  });
});
