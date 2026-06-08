import { describe, it, expect } from "vitest";
import { buildEffectiveRecipe, computeFingerprint } from "./recipe.ts";

const BUNDLE = "journeyman/runner-bundle:dev";

describe("buildEffectiveRecipe", () => {
  it("wraps a dockerfile with the kit graft", () => {
    const r = buildEffectiveRecipe({ kind: "dockerfile", content: "FROM python:3.12\n" }, BUNDLE);
    expect(r).toContain("FROM python:3.12");
    expect(r).toContain(`COPY --from=${BUNDLE} /opt/journeyman /opt/journeyman`);
  });

  it("treats a ref as a one-line FROM, still grafting the kit", () => {
    const r = buildEffectiveRecipe({ kind: "ref", imageRef: "node:20" }, BUNDLE);
    expect(r).toContain("FROM node:20");
    expect(r).toContain(`COPY --from=${BUNDLE} /opt/journeyman`);
  });

  it("returns null for an empty image (no build needed)", () => {
    expect(buildEffectiveRecipe(undefined, BUNDLE)).toBeNull();
    expect(buildEffectiveRecipe({ kind: "ref", imageRef: "" }, BUNDLE)).toBeNull();
  });
});

describe("computeFingerprint", () => {
  it("is stable for the same recipe + bundle id", () => {
    const a = computeFingerprint("FROM x\n", "sha256:abc");
    const b = computeFingerprint("FROM x\n", "sha256:abc");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
  it("changes when the bundle id (kit) changes", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc"))
      .not.toBe(computeFingerprint("FROM x\n", "sha256:def"));
  });
  it("changes when the base-ref id changes", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc", "sha256:ref1"))
      .not.toBe(computeFingerprint("FROM x\n", "sha256:abc", "sha256:ref2"));
  });
  it("is unchanged for the legacy 2-arg call (baseRefId defaults to empty)", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc"))
      .toBe(computeFingerprint("FROM x\n", "sha256:abc", ""));
  });
});
