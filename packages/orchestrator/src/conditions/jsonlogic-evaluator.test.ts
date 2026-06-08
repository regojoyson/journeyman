import assert from "node:assert/strict";
import { test } from "vitest";
import { JsonLogicEvaluator, normalizeVarPath } from "./jsonlogic-evaluator.ts";

test("normalizeVarPath strips $. prefix and bracket indexing", () => {
  assert.equal(normalizeVarPath("$.issue.state"), "issue.state");
  assert.equal(normalizeVarPath("issue.state"), "issue.state");
  assert.equal(normalizeVarPath("$.labels[0].name"), "labels.0.name");
  assert.equal(normalizeVarPath("$"), "");
  assert.equal(normalizeVarPath("  $.a.b  "), "a.b");
});

test("JsonLogicEvaluator resolves $.-paths against the issues payload", () => {
  const ev = new JsonLogicEvaluator();
  const payload = {
    action: "opened",
    issue: { number: 7, title: "Bug", state: "open", user: { login: "alice" } },
    repository: { full_name: "acme/demo" },
    sender: { login: "alice" },
    labels: [{ name: "bug" }],
  };

  // $.-prefixed paths now resolve
  assert.equal(ev.evaluate({ "==": [{ var: "$.issue.state" }, "open"] }, payload), true);
  // plain paths still work (no regression)
  assert.equal(ev.evaluate({ "==": [{ var: "issue.state" }, "open"] }, payload), true);
  // nested $.
  assert.equal(ev.evaluate({ "==": [{ var: "$.issue.user.login" }, "alice"] }, payload), true);
  // array indexing
  assert.equal(ev.evaluate({ "==": [{ var: "$.labels[0].name" }, "bug"] }, payload), true);
  // negation / and
  assert.equal(ev.evaluate({ "!=": [{ var: "$.issue.state" }, "closed"] }, payload), true);
  assert.equal(ev.evaluate({ and: [
    { "==": [{ var: "$.issue.state" }, "open"] },
    { "==": [{ var: "$.action" }, "opened"] },
  ] }, payload), true);
  // non-matching → false (not a throw)
  assert.equal(ev.evaluate({ "==": [{ var: "$.issue.state" }, "closed"] }, payload), false);
  // missing path → comparison false, no throw
  assert.equal(ev.evaluate({ "==": [{ var: "$.nope.gone" }, "x"] }, payload), false);
  // null expression → false
  assert.equal(ev.evaluate(null, payload), false);
});
