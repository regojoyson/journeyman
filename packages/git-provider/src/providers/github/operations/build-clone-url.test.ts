import assert from "node:assert/strict";
import { buildCloneUrl } from "./build-clone-url.ts";
import { test } from "vitest";

test("build-clone-url (assertions)", () => {
  {
    const out = buildCloneUrl("https://github.com/org/repo", "tok");
    assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
  }

  {
    const out = buildCloneUrl("https://github.com/org/repo.git", "tok");
    assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
  }

  assert.throws(
    () => buildCloneUrl("git@github.com:org/repo.git", "tok"),
    /only https:\/\/ URLs supported/,
  );

  assert.throws(
    () => buildCloneUrl("https://gitlab.com/org/repo", "tok"),
    /only github\.com host supported/,
  );

  assert.throws(
    () => buildCloneUrl("https://github.com/org/repo", ""),
    /token required/,
  );
});
