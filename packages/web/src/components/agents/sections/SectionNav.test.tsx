import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionNav, SECTIONS } from "./SectionNav.tsx";

describe("SectionNav", () => {
  it("renders every section label", () => {
    const html = renderToStaticMarkup(<SectionNav active="instructions" onSelect={() => {}} />);
    // renderToStaticMarkup HTML-escapes "&" → "&amp;"
    for (const s of SECTIONS) expect(html).toContain(s.label.replace(/&/g, "&amp;"));
  });
  it("exposes the seven sections in order ending with run history", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      "instructions", "workspace", "triggers", "behavior", "permissions", "notifications", "runs",
    ]);
  });
});
