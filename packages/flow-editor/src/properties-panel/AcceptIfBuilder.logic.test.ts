import assert from "node:assert/strict";
import { rulesToJsonLogic, jsonLogicToRules, ruleError, type BuilderState } from "./AcceptIfBuilder.logic.ts";

const state = (combinator: BuilderState["combinator"], rules: BuilderState["rules"]): BuilderState =>
  ({ combinator, rules });

// rulesToJsonLogic: empty → undefined
{
  assert.equal(rulesToJsonLogic(state("and", [])), undefined);
}

// rulesToJsonLogic: all-invalid → undefined
{
  assert.equal(rulesToJsonLogic(state("and", [{ field: "", op: "eq", value: "x" }])), undefined);
}

// rulesToJsonLogic: single rule emits the rule directly (no wrapper)
{
  const out = rulesToJsonLogic(state("and", [{ field: "issue.status", op: "eq", value: "Done" }]));
  assert.deepEqual(out, { "==": [{ var: "issue.status" }, "Done"] });
}

// rulesToJsonLogic: two rules → and wrapper
{
  const out = rulesToJsonLogic(state("and", [
    { field: "a", op: "eq", value: "1" },
    { field: "b", op: "neq", value: "2" },
  ]));
  assert.deepEqual(out, {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { "!=": [{ var: "b" }, "2"] },
    ],
  });
}

// rulesToJsonLogic: two rules → or wrapper
{
  const out = rulesToJsonLogic(state("or", [
    { field: "a", op: "eq", value: "1" },
    { field: "b", op: "eq", value: "2" },
  ]));
  assert.deepEqual(out, {
    or: [
      { "==": [{ var: "a" }, "1"] },
      { "==": [{ var: "b" }, "2"] },
    ],
  });
}

// rulesToJsonLogic: in/nin split CSV → array of strings
{
  const out = rulesToJsonLogic(state("and", [{ field: "state", op: "in", value: "approved, changes_requested" }]));
  assert.deepEqual(out, { in: [{ var: "state" }, ["approved", "changes_requested"]] });
}

// rulesToJsonLogic: in with all-numeric CSV → array of numbers
{
  const out = rulesToJsonLogic(state("and", [{ field: "n", op: "in", value: "1,2,3" }]));
  assert.deepEqual(out, { in: [{ var: "n" }, [1, 2, 3]] });
}

// rulesToJsonLogic: nin wraps with !
{
  const out = rulesToJsonLogic(state("and", [{ field: "state", op: "nin", value: "draft" }]));
  assert.deepEqual(out, { "!": { in: [{ var: "state" }, ["draft"]] } });
}

// rulesToJsonLogic: contains uses substring form
{
  const out = rulesToJsonLogic(state("and", [{ field: "title", op: "contains", value: "WIP" }]));
  assert.deepEqual(out, { in: ["WIP", { var: "title" }] });
}

// rulesToJsonLogic: empty / notEmpty have no value
{
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "x", op: "empty" }])),
    { "!": { var: "x" } },
  );
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "x", op: "notEmpty" }])),
    { "!!": { var: "x" } },
  );
}

// rulesToJsonLogic: gt/lt coerce to number
{
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "n", op: "gt", value: "5" }])),
    { ">": [{ var: "n" }, 5] },
  );
  assert.deepEqual(
    rulesToJsonLogic(state("and", [{ field: "n", op: "lt", value: "10" }])),
    { "<": [{ var: "n" }, 10] },
  );
}

// rulesToJsonLogic: eq with valueType=number → number literal
{
  const out = rulesToJsonLogic(state("and", [{ field: "n", op: "eq", value: "5", valueType: "number" }]));
  assert.deepEqual(out, { "==": [{ var: "n" }, 5] });
}

// rulesToJsonLogic: eq with valueType=boolean → boolean literal
{
  const out = rulesToJsonLogic(state("and", [{ field: "b", op: "eq", value: "true", valueType: "boolean" }]));
  assert.deepEqual(out, { "==": [{ var: "b" }, true] });
}

// rulesToJsonLogic: mix of valid + invalid → only valid emitted
{
  const out = rulesToJsonLogic(state("and", [
    { field: "",  op: "eq", value: "x" },
    { field: "a", op: "eq", value: "1" },
  ]));
  assert.deepEqual(out, { "==": [{ var: "a" }, "1"] });
}

// ruleError sanity
{
  assert.equal(ruleError({ field: "x", op: "empty" }), null);
  assert.equal(ruleError({ field: "",  op: "eq", value: "1" }), "Pick a field");
  assert.equal(ruleError({ field: "x", op: "gt", value: "abc" }), "Must be a number");
  assert.equal(ruleError({ field: "x", op: "in", value: " , , " }), "Enter at least one value");
}

// jsonLogicToRules: undefined / null / non-object → null
{
  assert.equal(jsonLogicToRules(undefined), null);
  assert.equal(jsonLogicToRules(null), null);
  assert.equal(jsonLogicToRules("nope"), null);
}

// jsonLogicToRules: single rule (no wrapper) → combinator and, one rule
{
  const parsed = jsonLogicToRules({ "==": [{ var: "a" }, "1"] });
  assert.deepEqual(parsed, { combinator: "and", rules: [{ field: "a", op: "eq", value: "1" }] });
}

// jsonLogicToRules: each operator round-trips
{
  const cases: BuilderState[] = [
    state("and", [{ field: "a", op: "eq",       value: "1" }]),
    state("and", [{ field: "a", op: "neq",      value: "1" }]),
    state("and", [{ field: "a", op: "in",       value: "x, y" }]),
    state("and", [{ field: "a", op: "nin",      value: "x" }]),
    state("and", [{ field: "a", op: "contains", value: "WIP" }]),
    state("and", [{ field: "a", op: "empty" }]),
    state("and", [{ field: "a", op: "notEmpty" }]),
    state("and", [{ field: "a", op: "gt",       value: "5" }]),
    state("and", [{ field: "a", op: "lt",       value: "10" }]),
  ];
  for (const original of cases) {
    const json = rulesToJsonLogic(original);
    const parsed = jsonLogicToRules(json);
    assert.notEqual(parsed, null, `parse failed for op ${original.rules[0].op}`);
    const reSerialized = rulesToJsonLogic(parsed!);
    assert.deepEqual(reSerialized, json, `round-trip mismatch for op ${original.rules[0].op}`);
  }
}

// jsonLogicToRules: numeric CSV in / nin round-trips as numbers
{
  const json = { in: [{ var: "n" }, [1, 2, 3]] };
  const parsed = jsonLogicToRules(json);
  assert.deepEqual(parsed, { combinator: "and", rules: [{ field: "n", op: "in", value: "1, 2, 3" }] });
  assert.deepEqual(rulesToJsonLogic(parsed!), json);
}

// jsonLogicToRules: and / or with two rules → matching combinator
{
  const json = {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { "!=": [{ var: "b" }, "2"] },
    ],
  };
  const parsed = jsonLogicToRules(json);
  assert.deepEqual(parsed, {
    combinator: "and",
    rules: [
      { field: "a", op: "eq",  value: "1" },
      { field: "b", op: "neq", value: "2" },
    ],
  });
}

// jsonLogicToRules: nested combinator → null (out of grammar)
{
  const json = {
    and: [
      { "==": [{ var: "a" }, "1"] },
      { or: [{ "==": [{ var: "b" }, "2"] }] },
    ],
  };
  assert.equal(jsonLogicToRules(json), null);
}

// jsonLogicToRules: unknown operator → null
{
  assert.equal(jsonLogicToRules({ "regex": [{ var: "a" }, "^x"] }), null);
}

console.log("AcceptIfBuilder.logic: all assertions passed");
