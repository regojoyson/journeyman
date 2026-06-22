import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { WorkflowInputDef } from "@journeyman/core";
import { RunFlowDialog } from "./RunFlowDialog.tsx";

function render(inputDefs: WorkflowInputDef[]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunFlowDialog
        wsId="w1"
        workflowId="wf1"
        workflowName="Nightly sync"
        inputDefs={inputDefs}
        onClose={() => {}}
        onSubmitted={() => {}}
      />
    </MemoryRouter>,
  );
}

const inputs: WorkflowInputDef[] = [
  { name: "ticket", type: "string", required: true },
  { name: "dryRun", type: "boolean", required: false },
];

describe("RunFlowDialog", () => {
  it("renders the title, workflow name, and each input field", () => {
    const html = render(inputs);
    expect(html).toContain("Run workflow");
    expect(html).toContain("Nightly sync");
    expect(html).toContain("ticket");
    expect(html).toContain("dryRun");
  });

  it("disables Run while a required field is empty", () => {
    const html = render(inputs);
    expect(html).toContain('disabled=""');
  });

  it("shows a no-inputs confirmation and an enabled Run button when there are no inputs", () => {
    const html = render([]);
    expect(html).toContain("takes no inputs");
    expect(html).toContain("Nightly sync");
    expect(html).not.toContain('disabled=""');
  });
});
