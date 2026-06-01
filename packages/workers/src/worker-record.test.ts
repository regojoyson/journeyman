import { describe, it, expect } from "vitest";
import { validateWorkerInput, rowToWorker, InvalidWorkerInputError } from "./worker-record.ts";

describe("validateWorkerInput", () => {
  const ok = { name: "Java builder", type: "docker", executionMode: "per-instance" };

  it("accepts a valid worker", () => {
    expect(() => validateWorkerInput(ok)).not.toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateWorkerInput({ ...ok, name: "  " })).toThrow(InvalidWorkerInputError);
  });

  it("rejects an unknown type", () => {
    expect(() => validateWorkerInput({ ...ok, type: "mainframe" })).toThrow(/type/);
  });

  it("rejects an unknown execution mode", () => {
    expect(() => validateWorkerInput({ ...ok, executionMode: "whenever" })).toThrow(/executionMode/);
  });

  it("rejects an unknown connectivity", () => {
    expect(() => validateWorkerInput({ ...ok, connectivity: "carrier-pigeon" })).toThrow(/connectivity/);
  });
});

describe("rowToWorker", () => {
  it("maps a snake_case DB row to a WorkerRecord and parses config/tags", () => {
    const created = new Date("2026-05-30T00:00:00Z");
    const rec = rowToWorker({
      id: "w1",
      scope: "org",
      org_id: "o1",
      user_id: null,
      name: "Java builder",
      type: "docker",
      execution_mode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
      is_default: false,
      tags: ["java"],
      enabled: true,
      created_by: "u1",
      created_at: created,
      updated_at: created,
    });
    expect(rec).toEqual({
      id: "w1",
      scope: "org",
      orgId: "o1",
      userId: null,
      name: "Java builder",
      type: "docker",
      executionMode: "per-instance",
      connectivity: "push",
      config: { image: { kind: "ref", imageRef: "x:1" } },
      isDefault: false,
      tags: ["java"],
      enabled: true,
      createdBy: "u1",
      createdAt: created,
      updatedAt: created,
    });
  });
});
