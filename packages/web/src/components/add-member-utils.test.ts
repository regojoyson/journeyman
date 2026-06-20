import { describe, it, expect } from "vitest";
import { filterAddableUsers } from "./add-member-utils.ts";

const users = [
  { id: "u1", username: "dana", displayName: "Dana Kim", status: "active" },
  { id: "u2", username: "raj", displayName: null, status: "active" },
  { id: "u3", username: "dario", displayName: "Dario Penn", status: "active" },
];

describe("filterAddableUsers", () => {
  it("excludes ids in the excluded set", () => {
    const r = filterAddableUsers(users, new Set(["u1"]), "");
    expect(r.map((u) => u.id)).toEqual(["u2", "u3"]);
  });
  it("filters by username case-insensitively", () => {
    const r = filterAddableUsers(users, new Set(), "DA");
    expect(r.map((u) => u.id)).toEqual(["u1", "u3"]);
  });
  it("filters by displayName", () => {
    const r = filterAddableUsers(users, new Set(), "penn");
    expect(r.map((u) => u.id)).toEqual(["u3"]);
  });
  it("returns all non-excluded when query is blank/whitespace", () => {
    expect(filterAddableUsers(users, new Set(), "  ")).toHaveLength(3);
  });
});
