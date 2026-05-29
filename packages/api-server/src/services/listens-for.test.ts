import assert from "node:assert/strict";
import { eventPassesListensFor } from "./listens-for.ts";

// Empty / undefined allowlist → allow anything, including unknown type.
assert.equal(eventPassesListensFor(undefined, "anything"), true);
assert.equal(eventPassesListensFor([], "anything"), true);
assert.equal(eventPassesListensFor([], null), true);

// Non-empty allowlist → fire only on a known, listed type.
assert.equal(eventPassesListensFor(["issues"], "issues"), true);
assert.equal(eventPassesListensFor(["issues"], "issue_comment"), false);
assert.equal(eventPassesListensFor(["issues"], null), false);
assert.equal(eventPassesListensFor(["issues"], undefined), false);
assert.equal(eventPassesListensFor(["issues", "push"], "push"), true);

console.log("listens-for: ok");
