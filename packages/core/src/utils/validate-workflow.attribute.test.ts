import assert from "node:assert/strict";
import type { WorkflowGraph } from "../types/flow.types.ts";
import { validateWorkflowInputs } from "./validate-workflow.ts";
import { validateForPublish } from "../validation/validate-for-publish.ts";
import { test } from "vitest";

test("validate-workflow.attribute (assertions)", () => {
  // Mirrors the user's reported graph: a custom-ai step binds `workspaceDir` to a
  // design-time attribute via `workflow.attribute.workspaceDir`.
  const flow = {
    schemaVersion: 2,
    inputDefs: [{ name: "payload", type: "json-object", required: true }],
    attributeDefs: [{ name: "workspaceDir", type: "string", value: "/tmp/1" }],
    nodes: [
      { id: "start", type: "trigger-manual" },
      { id: "end", type: "end" },
      {
        id: "step_1",
        type: "step",
        stepType: "custom-ai",
        displayName: "Say hello",
        config: { customStepId: "cs_1" },
        inputs: {
          payload: { kind: "ref", ref: "workflow.input.payload" },
          workspaceDir: { kind: "ref", ref: "workflow.attribute.workspaceDir" },
        },
      },
    ],
    edges: [
      { id: "e1", type: "default", source: "start", target: "step_1" },
      { id: "e2", type: "default", source: "step_1", target: "end" },
    ],
  } as unknown as WorkflowGraph;

  // Catalog: custom-ai step with a string `workspaceDir` input + json-object payload.
  const catalog = {
    "custom-ai": {
      stepType: "custom-ai",
      inputFields: {},
      outputSchema: {},
      customSteps: {
        cs_1: {
          name: "Say hello",
          inputFields: {
            payload: { shape: { type: "json", container: "object" } },
            workspaceDir: { shape: { type: "string" } },
          },
          outputSchema: {},
        },
      },
    },
  } as unknown as Parameters<typeof validateWorkflowInputs>[1];

  // 1. validateWorkflowInputs: no "malformed" / "undeclared attribute" warning for the attribute ref.
  const warnings = validateWorkflowInputs(flow, catalog);
  const attrWarnings = warnings.filter(w => "ref" in w && String((w as { ref?: string }).ref).includes("workflow.attribute"));
  assert.deepEqual(attrWarnings, [], `expected no attribute-ref warnings, got ${JSON.stringify(attrWarnings)}`);

  // 2. validateForPublish: no "references node 'workflow' which is not upstream" error.
  const publish = validateForPublish(flow, { hasTrigger: true });
  const upstreamErr = publish.errors.find(e => e.message.includes("references node 'workflow'"));
  assert.equal(upstreamErr, undefined, `expected no upstream error, got ${JSON.stringify(upstreamErr)}`);

  // 3. Undeclared attribute still flagged.
  const flowBad = JSON.parse(JSON.stringify(flow)) as WorkflowGraph;
  flowBad.attributeDefs = [];
  const warningsBad = validateWorkflowInputs(flowBad, catalog);
  const undeclared = warningsBad.find(w => "ref" in w && String((w as { ref?: string }).ref) === "workflow.attribute.workspaceDir");
  assert.ok(undeclared, "undeclared attribute ref should produce a warning");
});
