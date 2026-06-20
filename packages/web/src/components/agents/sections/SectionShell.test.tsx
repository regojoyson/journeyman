import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

describe("FieldLabel", () => {
  it("renders children without an info icon when help is not provided", () => {
    const html = renderToStaticMarkup(<FieldLabel>Max steps</FieldLabel>);
    expect(html).toContain("Max steps");
    expect(html).not.toContain("cursor-help");
  });

  it("renders the tooltip text in the DOM when help is provided", () => {
    const html = renderToStaticMarkup(
      <FieldLabel help="Maximum reasoning steps the agent takes per run">Max steps</FieldLabel>
    );
    expect(html).toContain("Max steps");
    expect(html).toContain("Maximum reasoning steps the agent takes per run");
    expect(html).toContain("cursor-help");
  });
});

describe("SectionShell", () => {
  it("renders title and children with no alert box when description is absent", () => {
    const html = renderToStaticMarkup(
      <SectionShell title="Behavior"><span>content</span></SectionShell>
    );
    expect(html).toContain("Behavior");
    expect(html).toContain("content");
    expect(html).not.toContain("bg-primary/10");
  });

  it("renders description inside an alert box when description is provided", () => {
    const html = renderToStaticMarkup(
      <SectionShell title="Behavior" description="Max steps stops runaway loops.">
        <span>content</span>
      </SectionShell>
    );
    expect(html).toContain("Behavior");
    expect(html).toContain("Max steps stops runaway loops.");
    expect(html).toContain("bg-primary/10");
  });
});
