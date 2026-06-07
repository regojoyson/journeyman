import { describe, it, expect } from "vitest";
import { validateComputeTargetInput, rowToComputeTarget, InvalidComputeTargetInputError } from "./compute-target-record.ts";

describe("validateComputeTargetInput", () => {
  const ok = { name: "Java builder", type: "docker", executionMode: "per-instance" };

  it("accepts a valid worker", () => {
    expect(() => validateComputeTargetInput(ok)).not.toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateComputeTargetInput({ ...ok, name: "  " })).toThrow(InvalidComputeTargetInputError);
  });

  it("rejects an unknown type", () => {
    expect(() => validateComputeTargetInput({ ...ok, type: "mainframe" })).toThrow(/type/);
  });

  it("rejects an unknown execution mode", () => {
    expect(() => validateComputeTargetInput({ ...ok, executionMode: "whenever" })).toThrow(/executionMode/);
  });

  it("rejects an unknown connectivity", () => {
    expect(() => validateComputeTargetInput({ ...ok, connectivity: "carrier-pigeon" })).toThrow(/connectivity/);
  });
});

describe("rowToComputeTarget", () => {
  it("maps a snake_case DB row to a ComputeTarget and parses config/tags", () => {
    const created = new Date("2026-05-30T00:00:00Z");
    const rec = rowToComputeTarget({
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
      tags: ["java"],
      enabled: true,
      createdBy: "u1",
      createdAt: created,
      updatedAt: created,
      imageState: "none",
      imageFingerprint: null,
      imageRef: null,
      imageError: null,
      imageBuiltAt: null,
    });
  });

  it("maps image_* columns when present", () => {
    const ct = rowToComputeTarget({
      id: "t1", scope: "org", org_id: "o1", user_id: null, name: "Python",
      type: "docker", execution_mode: "per-instance", connectivity: "push",
      config: {}, is_default: false, tags: [], enabled: true, created_by: null,
      created_at: new Date(0), updated_at: new Date(0),
      image_state: "ready", image_fingerprint: "abc", image_ref: "journeyman/jm-built:abc",
      image_error: null, image_built_at: new Date(0),
    });
    expect(ct.imageState).toBe("ready");
    expect(ct.imageRef).toBe("journeyman/jm-built:abc");
    expect(ct.imageFingerprint).toBe("abc");
  });

  it("defaults image_state to 'none' when the column is absent", () => {
    const ct = rowToComputeTarget({
      id: "t2", scope: "system", org_id: null, user_id: null, name: "Local",
      type: "local", execution_mode: "shared", connectivity: null,
      config: {}, is_default: true, tags: [], enabled: true, created_by: null,
      created_at: new Date(0), updated_at: new Date(0),
    });
    expect(ct.imageState).toBe("none");
    expect(ct.imageRef).toBeNull();
  });
});
