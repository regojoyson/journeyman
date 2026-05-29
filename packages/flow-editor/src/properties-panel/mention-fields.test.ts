import assert from "node:assert/strict";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { toMentionFields } from "./mention-fields.ts";

const sources: UpstreamSource[] = [
  {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [{ name: "ticketId", scope: "run-input", shape: { type: "string" } }],
    }],
  },
  {
    kind: "node",
    id: "ht_a1b2c3",
    label: "Human Task",
    groups: [{
      title: "Outputs",
      scope: "output",
      fields: [
        { name: "approved", scope: "output", shape: { type: "boolean" } },
        { name: "report", scope: "output", shape: { type: "object", fields: { score: { type: "number" } } } },
        { name: "payload", scope: "output", shape: { type: "object", fields: {} } },
      ],
    }],
  },
  {
    kind: "node",
    id: "ht_f9e2d1",
    label: "Human Task",
    groups: [{
      title: "Outputs",
      scope: "output",
      fields: [{ name: "approved", scope: "output", shape: { type: "boolean" } }],
    }],
  },
];

const fields = toMentionFields(sources);

// run-input ref + path
const ticket = fields.find(f => f.ref === "workflow.input.ticketId");
assert.ok(ticket);
assert.equal(ticket!.fieldPath, "ticketId");
assert.equal(ticket!.type, "string");
assert.equal(ticket!.showId, false);
assert.deepEqual(ticket!.shape, { type: "string" });

// output leaf
const approved = fields.find(f => f.ref === "ht_a1b2c3.output.approved");
assert.ok(approved);
assert.equal(approved!.fieldPath, "output.approved");
assert.equal(approved!.sourceLabel, "Human Task");
assert.equal(approved!.showId, true); // duplicate "Human Task" label

// nested object leaf
const score = fields.find(f => f.ref === "ht_a1b2c3.output.report.score");
assert.ok(score);
assert.equal(score!.fieldPath, "output.report.score");
assert.equal(score!.type, "number");

// free-form object emitted as-is (no recursion past it)
const payload = fields.find(f => f.ref === "ht_a1b2c3.output.payload");
assert.ok(payload);
assert.equal(payload!.type, "object");
assert.equal(fields.some(f => f.ref.startsWith("ht_a1b2c3.output.payload.")), false);

// unique-label source is not flagged
assert.equal(ticket!.showId, false);

// json object run-input flattens to one opaque leaf
{
  const src: UpstreamSource = {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [{ name: "payload", scope: "run-input", shape: { type: "json", container: "object" } }],
    }],
  };
  const f = toMentionFields([src]);
  const payloadLeaf = f.find(x => x.ref === "workflow.input.payload");
  assert.ok(payloadLeaf, "json object run-input should produce a leaf");
  assert.equal(payloadLeaf!.type, "json object");
  assert.equal(f.some(x => x.ref.startsWith("workflow.input.payload.")), false);
}

console.log("mention-fields: ok");
