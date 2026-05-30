import assert from "node:assert/strict";
import type { WorkflowGraph } from "@journeyman/core";
import { isValidPhase4Graph } from "./validation.ts";

// Minimal valid linear flow: trigger → webhook-wait → end.
function baseFlow(outputs: Array<{ name: string; type: string }>): WorkflowGraph {
  return {
    schemaVersion: 2,
    nodes: [
      { id: "start", type: "trigger-manual" },
      { id: "ww", type: "webhook-wait", displayName: "Webhook Wait", config: { webhookId: "w1", outputs } },
      { id: "end", type: "end" },
    ],
    edges: [
      { id: "e1", type: "default", source: "start", target: "ww" },
      { id: "e2", type: "default", source: "ww", target: "end" },
    ],
  } as unknown as WorkflowGraph;
}

// Reserved output name → not ok, with a node-attributed error mentioning the name.
const bad = isValidPhase4Graph(baseFlow([{ name: "payload", type: "json" }]));
assert.equal(bad.ok, false, "reserved output name should fail the publish gate");
const issue = bad.issues.find(i => i.nodeId === "ww" && /payload/.test(i.message));
assert.ok(issue, `expected a node-attributed error mentioning 'payload', got ${JSON.stringify(bad.issues)}`);
assert.equal(issue!.severity, "error");

// Clean output name → no output-name error on the node.
const good = isValidPhase4Graph(baseFlow([{ name: "issueNumber", type: "number" }]));
const outErr = good.issues.find(i => i.nodeId === "ww" && /reserved|Duplicate|invalid/.test(i.message));
assert.equal(outErr, undefined, `clean output should not produce a name error, got ${JSON.stringify(outErr)}`);

console.log("validation.pause-output-names: ok");
