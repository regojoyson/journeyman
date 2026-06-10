import assert from "node:assert/strict";
import { test } from "vitest";
import type { WorkflowDefaults, WorkflowNode } from "@journeyman/core";
import { applyDefaultsToNewNode } from "./flow-graph.ts";

const baseNode: WorkflowNode = {
  id: "step_abc123",
  type: "step",
  stepType: "custom-ai",
  displayName: "Custom AI",
  config: {},
};

test("applyDefaultsToNewNode: copies all four defaults onto the node", () => {
  const defaults: WorkflowDefaults = {
    executorConfig: { "coding-cli": { provider: "opencode" } },
    defaultModel: "claude-opus-4-8",
    retry: { enabled: true, maxAttempts: 3 },
    sandboxId: "sbx-1",
  };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.deepEqual(node.executorConfig, { provider: "opencode" });
  assert.equal(node.model, "claude-opus-4-8");
  assert.deepEqual(node.retry, { enabled: true, maxAttempts: 3 });
  assert.equal(node.sandboxId, "sbx-1");
});

test("applyDefaultsToNewNode: no defaults → provider falls back to system, rest unset", () => {
  const node = applyDefaultsToNewNode(baseNode, undefined, "coding-cli", "claude");
  assert.deepEqual(node.executorConfig, { provider: "claude" });
  assert.equal(node.model, undefined);
  assert.equal(node.retry, undefined);
  assert.equal(node.sandboxId, undefined);
});

test("applyDefaultsToNewNode: partial defaults → only set fields copied, provider still resolves", () => {
  const defaults: WorkflowDefaults = { defaultModel: "claude-sonnet-4-6" };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.equal(node.model, "claude-sonnet-4-6");
  assert.deepEqual(node.executorConfig, { provider: "claude" });
  assert.equal(node.retry, undefined);
  assert.equal(node.sandboxId, undefined);
});

test("applyDefaultsToNewNode: no workflow provider and no system provider → executorConfig undefined", () => {
  const node = applyDefaultsToNewNode(baseNode, {}, "coding-cli", undefined);
  assert.equal(node.executorConfig, undefined);
});

test("applyDefaultsToNewNode: retry is a fresh copy, not shared with defaults", () => {
  const defaults: WorkflowDefaults = { retry: { enabled: true, maxAttempts: 2 } };
  const node = applyDefaultsToNewNode(baseNode, defaults, "coding-cli", "claude");
  assert.notEqual(node.retry, defaults.retry); // different object reference
  assert.deepEqual(node.retry, defaults.retry); // same values
});

test("applyDefaultsToNewNode: does not mutate the input node", () => {
  const input: WorkflowNode = { ...baseNode };
  applyDefaultsToNewNode(input, { defaultModel: "x" }, "coding-cli", "claude");
  assert.equal(input.model, undefined);
  assert.equal(input.executorConfig, undefined);
});
