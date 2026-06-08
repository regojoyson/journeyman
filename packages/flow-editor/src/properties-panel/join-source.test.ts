import assert from "node:assert/strict";
import type { WorkflowNode } from "@journeyman/core";
import { joinSource } from "./join-source.ts";
import { test } from "vitest";

test("join-source (assertions)", () => {
  function group(src: ReturnType<typeof joinSource>, title: string) {
    assert.ok(src, "expected source");
    const g = src!.groups.find(x => x.title === title);
    assert.ok(g, `expected group ${title}`);
    return g!;
  }

  // === fail-fast (explicit) → null ===
  {
    const node: WorkflowNode = { id: "j1", type: "join", config: { mode: "fail-fast" } };
    assert.equal(joinSource(node), null);
  }
  // === no mode → defaults to first-wins (DEFAULT_JOIN_MODE) → winner + output + results ===
  {
    const node: WorkflowNode = { id: "j1", type: "join" };
    const src = joinSource(node);
    assert.ok(src, "unset-mode join should default to first-wins, not null");
    const outs = group(src, "Outputs");
    assert.deepEqual(outs.fields.map(f => f.name), ["winner", "output", "results"]);
  }

  // === wait-all → results only ===
  {
    const node: WorkflowNode = {
      id: "j2",
      type: "join",
      displayName: "Wait for branches",
      config: { mode: "wait-all" },
    };
    const src = joinSource(node);
    assert.ok(src);
    assert.equal(src!.id, "j2");
    assert.equal(src!.label, "Wait for branches");
    const outs = group(src, "Outputs");
    assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
      ["results", { type: "object", fields: {} }],
    ]);
  }

  // === wait-all-strict → results only ===
  {
    const node: WorkflowNode = { id: "j3", type: "join", config: { mode: "wait-all-strict" } };
    const src = joinSource(node);
    assert.ok(src);
    assert.equal(src!.label, "Join");
    const outs = group(src, "Outputs");
    assert.deepEqual(outs.fields.map(f => f.name), ["results"]);
  }

  // === first-wins → winner + output + results ===
  {
    const node: WorkflowNode = { id: "j4", type: "join", config: { mode: "first-wins" } };
    const src = joinSource(node);
    assert.ok(src);
    const outs = group(src, "Outputs");
    assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
      ["winner",  { type: "string" }],
      ["output",  { type: "object", fields: {} }],
      ["results", { type: "object", fields: {} }],
    ]);
  }

  // === non-join node returns null ===
  {
    const node: WorkflowNode = { id: "s1", type: "step", stepType: "clone-repos" };
    assert.equal(joinSource(node), null);
  }
  {
    const node: WorkflowNode = { id: "t1", type: "trigger-manual" };
    assert.equal(joinSource(node), null);
  }
});
