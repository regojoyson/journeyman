import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptToolbar } from "./PromptToolbar.tsx";

describe("PromptToolbar", () => {
  it("renders the full set of formatting buttons", () => {
    const html = renderToStaticMarkup(<PromptToolbar onCommand={() => {}} />);
    for (const title of [
      "Bold (⌘B)", "Italic (⌘I)", "Strikethrough", "Inline code",
      "Heading 1", "Heading 2", "Heading 3",
      "Bullet list", "Numbered list", "Quote",
      "Code block", "Link",
    ]) {
      expect(html).toContain(`title="${title}"`);
    }
  });
});
