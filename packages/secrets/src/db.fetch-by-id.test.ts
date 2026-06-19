import { describe, it, expect } from "vitest";
import { fetchSecretById, getOrgSecretMeta } from "./db.ts";

describe("fetchSecretById / getOrgSecretMeta", () => {
  it("are exported and callable", () => {
    expect(typeof fetchSecretById).toBe("function");
    expect(typeof getOrgSecretMeta).toBe("function");
  });
});
