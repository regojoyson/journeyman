import { describe, it, expect } from "vitest";
import { workflowInputDefShape } from "./flow.types.ts";
import { shapeTag } from "../utils/validate-workflow.ts";

describe("workflowInputDefShape", () => {
  it("maps scalars", () => {
    expect(workflowInputDefShape({ name: "a", type: "string" })).toEqual({ type: "string" });
    expect(workflowInputDefShape({ name: "a", type: "number" })).toEqual({ type: "number" });
    expect(workflowInputDefShape({ name: "a", type: "boolean" })).toEqual({ type: "boolean" });
  });
  it("maps json object/array to json shapes", () => {
    expect(workflowInputDefShape({ name: "a", type: "json-object" }))
      .toEqual({ type: "json", container: "object" });
    expect(workflowInputDefShape({ name: "a", type: "json-array" }))
      .toEqual({ type: "json", container: "array" });
  });
});

describe("shapeTag — json", () => {
  it("renders friendly json tags", () => {
    expect(shapeTag({ type: "json", container: "object" })).toBe("json object");
    expect(shapeTag({ type: "json", container: "array" })).toBe("json array");
  });
});
