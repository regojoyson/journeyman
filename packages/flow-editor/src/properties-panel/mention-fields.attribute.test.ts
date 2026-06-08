import assert from "node:assert/strict";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { toMentionFields } from "./mention-fields.ts";
import { test } from "vitest";

test("mention-fields.attribute (assertions)", () => {
  const sources: UpstreamSource[] = [
    {
      kind: "workflow-attribute",
      id: "",
      label: "Default attributes",
      groups: [{
        title: "Default attributes",
        scope: "workflow-attribute",
        fields: [
          { name: "branchPrefix", scope: "workflow-attribute", shape: { type: "string" } },
          { name: "maxRetries", scope: "workflow-attribute", shape: { type: "number" } },
        ],
      }],
    },
  ];

  const fields = toMentionFields(sources);

  const prefix = fields.find(f => f.ref === "workflow.attribute.branchPrefix");
  assert.ok(prefix, "branchPrefix attribute should produce a leaf");
  assert.equal(prefix!.fieldPath, "branchPrefix");
  assert.equal(prefix!.type, "string");

  const retries = fields.find(f => f.ref === "workflow.attribute.maxRetries");
  assert.ok(retries, "maxRetries attribute should produce a leaf");
  assert.equal(retries!.type, "number");
});
