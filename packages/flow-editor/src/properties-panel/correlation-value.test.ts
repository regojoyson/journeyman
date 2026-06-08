import assert from "node:assert/strict";
import type { WorkflowInputValue } from "@journeyman/core";
import {
  correlationValueToSegments,
  segmentsToCorrelationValue,
} from "./correlation-value.ts";
import { test } from "vitest";

test("correlation-value (assertions)", () => {
  // undefined → empty
  assert.deepEqual(correlationValueToSegments(undefined), []);

  // template (braces) → ref segment
  assert.deepEqual(
    correlationValueToSegments({ kind: "template", template: "{{workflow.input.ticketId}}" }),
    [{ kind: "ref", ref: "workflow.input.ticketId" }],
  );

  // template with surrounding text → text + ref segments
  assert.deepEqual(
    correlationValueToSegments({ kind: "template", template: "id-{{a.output.x}}" }),
    [
      { kind: "text", text: "id-" },
      { kind: "ref", ref: "a.output.x" },
    ],
  );

  // literal → single text segment
  assert.deepEqual(
    correlationValueToSegments({ kind: "literal", value: "PR-1" }),
    [{ kind: "text", text: "PR-1" }],
  );

  // ref kind → single ref segment
  assert.deepEqual(
    correlationValueToSegments({ kind: "ref", ref: "a.output.x" }),
    [{ kind: "ref", ref: "a.output.x" }],
  );

  // segments → braces template value
  assert.deepEqual(
    segmentsToCorrelationValue([
      { kind: "text", text: "hi " },
      { kind: "ref", ref: "a.output.x" },
    ]),
    { kind: "template", template: "hi {{a.output.x}}" } satisfies WorkflowInputValue,
  );

  // empty segments → empty template value
  assert.deepEqual(
    segmentsToCorrelationValue([]),
    { kind: "template", template: "" } satisfies WorkflowInputValue,
  );
});
