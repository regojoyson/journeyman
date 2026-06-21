import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@journeyman/theme";
import { PromptEditor } from "./PromptEditor.tsx";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

const inputs: CustomStepInputField[] = [
  { name: "ticketKey", type: "string", required: true, description: "" },
];
const slots: SecretSlotDef[] = [
  { name: "GITHUB_TOKEN", description: "" },
];

// PromptCodeMirror calls useTheme(), so the editor must render inside a ThemeProvider.
function render(props: Partial<{ readOnly: boolean; hideSidebar: boolean }> = {}) {
  return renderToStaticMarkup(
    <ThemeProvider>
      <PromptEditor
        value="{{ticketKey}}"
        onChange={() => {}}
        inputFields={inputs}
        slots={slots}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("PromptEditor readOnly", () => {
  it("renders the toolbar and insert sidebar when editable", () => {
    const html = render();
    expect(html).toContain('title="Bold (⌘B)"');
    expect(html).toContain("click to insert");
    expect(html).not.toContain("Read-only");
  });

  it("hides the toolbar + sidebar and shows a read-only badge when readOnly", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain('title="Bold (⌘B)"');
    expect(html).not.toContain("click to insert");
    expect(html).toContain("Read-only");
  });
});

describe("PromptEditor hideSidebar", () => {
  it("keeps the editable toolbar but drops the insert sidebar", () => {
    const html = render({ hideSidebar: true });
    expect(html).toContain('title="Bold (⌘B)"');
    expect(html).not.toContain("click to insert");
    expect(html).not.toContain("Read-only");
  });
});
