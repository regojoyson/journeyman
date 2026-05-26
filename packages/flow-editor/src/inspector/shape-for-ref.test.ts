import assert from "node:assert/strict";
import type { UpstreamSource } from "../properties-panel/use-upstream-sources.ts";
import { shapeForRef } from "./shape-for-ref.ts";

const sources: UpstreamSource[] = [
  {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [
        { name: "ticketId", scope: "run-input", shape: { type: "string" } },
        { name: "retries",  scope: "run-input", shape: { type: "number" } },
      ],
    }],
  },
  {
    kind: "node",
    id: "analyze",
    label: "Analyze",
    groups: [
      {
        title: "Inputs",
        scope: "input",
        fields: [
          { name: "issue", scope: "input", shape: { type: "string" } },
        ],
      },
      {
        title: "Outputs",
        scope: "output",
        fields: [
          { name: "ok",     scope: "output", shape: { type: "boolean" } },
          { name: "report", scope: "output", shape: { type: "object", fields: { score: { type: "number" }, label: { type: "string" } } } },
        ],
      },
    ],
  },
];

// run-input string
assert.deepEqual(shapeForRef("workflow.input.ticketId", sources), { type: "string" });

// run-input number
assert.deepEqual(shapeForRef("workflow.input.retries", sources), { type: "number" });

// step input
assert.deepEqual(shapeForRef("analyze.input.issue", sources), { type: "string" });

// step output boolean
assert.deepEqual(shapeForRef("analyze.output.ok", sources), { type: "boolean" });

// nested object leaf
assert.deepEqual(shapeForRef("analyze.output.report.score", sources), { type: "number" });

// unknown ref
assert.equal(shapeForRef("analyze.output.missing", sources), undefined);
assert.equal(shapeForRef("ghost.output.x", sources), undefined);
assert.equal(shapeForRef("workflow.input.unknown", sources), undefined);
assert.equal(shapeForRef("", sources), undefined);
assert.equal(shapeForRef("garbage", sources), undefined);

console.log("shape-for-ref: ok");
