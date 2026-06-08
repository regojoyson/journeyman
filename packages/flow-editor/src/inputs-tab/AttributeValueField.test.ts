import assert from "node:assert/strict";
import { parseAttributeValue } from "./AttributeValueField.tsx";
import { test } from "vitest";

test("AttributeValueField (assertions)", () => {
  // string passes through verbatim
  assert.deepEqual(parseAttributeValue("string", "feature/"), { ok: true, value: "feature/" });

  // number parses; non-numeric fails
  assert.deepEqual(parseAttributeValue("number", "42"), { ok: true, value: 42 });
  assert.equal(parseAttributeValue("number", "abc").ok, false);

  // boolean
  assert.deepEqual(parseAttributeValue("boolean", "true"), { ok: true, value: true });

  // json-object: valid object ok; array rejected for object container; malformed rejected
  assert.deepEqual(parseAttributeValue("json-object", '{"a":1}'), { ok: true, value: { a: 1 } });
  assert.equal(parseAttributeValue("json-object", "[1,2]").ok, false);
  assert.equal(parseAttributeValue("json-object", "{bad}").ok, false);

  // json-array: valid array ok; object rejected
  assert.deepEqual(parseAttributeValue("json-array", "[1,2]"), { ok: true, value: [1, 2] });
  assert.equal(parseAttributeValue("json-array", '{"a":1}').ok, false);
});
