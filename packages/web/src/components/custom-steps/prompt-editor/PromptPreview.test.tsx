import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptPreview } from "./PromptPreview.tsx";

function render(value: string, inputs: { name: string }[] = [], slots: { name: string }[] = []) {
  return renderToStaticMarkup(
    <PromptPreview
      value={value}
      inputFields={inputs.map(i => ({ name: i.name, type: "string", required: false }))}
      slots={slots.map(s => ({ name: s.name, description: "" }))}
    />,
  );
}

describe("PromptPreview", () => {
  it("renders an ATX heading", () => {
    const html = render("# header");
    expect(html).toContain("<h1");
    expect(html).toContain("header");
  });

  it("renders '#header' (no space) as literal text, not a heading", () => {
    const html = render("#header");
    expect(html).not.toContain("<h1");
    expect(html).toContain("#header");
  });

  it("renders a declared input token as a green chip inside a heading", () => {
    const html = render("# Review {{pr}}", [{ name: "pr" }]);
    expect(html).toContain("<h1");
    expect(html).toContain("bg-emerald");
    expect(html).toContain(">pr<");
  });

  it("renders an undeclared token as an amber chip", () => {
    const html = render("Use {{nope}}");
    expect(html).toContain("bg-amber");
  });

  it("leaves tokens inside a code fence untouched", () => {
    const html = render("```\n{{pr}}\n```", [{ name: "pr" }]);
    expect(html).not.toContain("bg-emerald");
    expect(html).toContain("{{pr}}");
  });
});
