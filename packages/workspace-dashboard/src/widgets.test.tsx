import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./widgets.tsx";

describe("Sparkline", () => {
  it("renders a visible marker for a single data point", () => {
    // A single point can't form a polyline segment, so the card body would be
    // blank unless the data point itself is drawn as a visible marker.
    const html = renderToStaticMarkup(
      createElement(Sparkline, { points: [{ value: 257_000, title: "2026-06-22 · 4m 17s" }] }),
    );
    expect(html).not.toContain("no data");
    // BLUE fill = a visible marker (the line uses stroke, not fill).
    expect(html).toMatch(/fill="#6aa9ff"/);
  });

  it("still renders a line for multiple points", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, {
        points: [
          { value: 100_000, title: "d1" },
          { value: 200_000, title: "d2" },
          { value: 150_000, title: "d3" },
        ],
      }),
    );
    expect(html).toContain("<polyline");
    expect(html).toMatch(/points="[^"]*\s[^"]*"/); // polyline has >1 coordinate
  });
});
