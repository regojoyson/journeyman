import assert from "node:assert/strict";
import type { WorkflowNode } from "@journeyman/core";
import { pauseNodeSource } from "./pause-node-source.ts";

function group(src: ReturnType<typeof pauseNodeSource>, title: string) {
  assert.ok(src, "expected source");
  const g = src!.groups.find(x => x.title === title);
  assert.ok(g, `expected group ${title}`);
  return g!;
}

// === human-task with declared outputs ===
{
  const node: WorkflowNode = {
    id: "ht1",
    type: "human-task",
    displayName: "Review PR",
    config: {
      outputs: [
        { name: "approved", type: "boolean" },
        { name: "comments", type: "string", description: "Reviewer comments" },
        { name: "score",    type: "number" },
        { name: "meta",     type: "json" },
        { name: "due",      type: "date" },
      ],
    },
  };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.id, "ht1");
  assert.equal(src!.label, "Review PR");
  assert.equal(src!.kind, "node");

  const outs = group(src, "Outputs");
  assert.equal(outs.scope, "output");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["approved", { type: "boolean" }],
    ["comments", { type: "string" }],
    ["score",    { type: "number" }],
    ["meta",     { type: "object", fields: {} }],
    ["due",      { type: "string" }],
  ]);
  assert.equal(outs.fields.find(f => f.name === "comments")!.description, "Reviewer comments");

  const sys = group(src, "System");
  assert.equal(sys.scope, "output");
  assert.deepEqual(sys.fields.map(f => f.name), ["source", "actor", "resolvedAt", "payload"]);
  assert.deepEqual(sys.fields.find(f => f.name === "payload")!.shape, { type: "object", fields: {} });
  assert.deepEqual(sys.fields.find(f => f.name === "source")!.shape, { type: "string" });
}

// === webhook-wait with one declared output ===
{
  const node: WorkflowNode = {
    id: "ww1",
    type: "webhook-wait",
    config: {
      outputs: [{ name: "pr_number", type: "number" }],
    },
  };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.label, "Webhook wait");

  const outs = group(src, "Outputs");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["pr_number", { type: "number" }],
  ]);

  const sys = group(src, "System");
  assert.deepEqual(sys.fields.map(f => f.name), ["source", "resolvedAt", "webhookEventId", "payload"]);
}

// === human-task with empty/missing outputs → only System group ===
{
  const node: WorkflowNode = { id: "ht2", type: "human-task", config: { outputs: [] } };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.groups.length, 1);
  assert.equal(src!.groups[0].title, "System");
}
{
  const node: WorkflowNode = { id: "ht3", type: "human-task" };
  const src = pauseNodeSource(node);
  assert.ok(src);
  assert.equal(src!.groups.length, 1);
  assert.equal(src!.groups[0].title, "System");
}

// === non-pause node returns null ===
{
  const node: WorkflowNode = { id: "s1", type: "step", stepType: "clone-repos" };
  assert.equal(pauseNodeSource(node), null);
}
{
  const node: WorkflowNode = { id: "t1", type: "trigger-manual" };
  assert.equal(pauseNodeSource(node), null);
}

console.log("pause-node-source: ok");
