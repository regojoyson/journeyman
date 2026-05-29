import assert from "node:assert/strict";
import type { PresetId } from "@journeyman/core";
import { getPreset } from "./loader.ts";

const expected: Record<string, string[]> = {
  github: ["push", "pull_request", "release", "create", "delete"],
  "github-issues": ["issues", "issue_comment"],
  jira: ["issue_updated", "issue_created", "comment_created", "issue_deleted"],
  gitlab: ["push", "merge_request", "pipeline", "tag_push"],
};

for (const [id, keys] of Object.entries(expected)) {
  const p = getPreset(id as PresetId);
  assert.ok(p, `preset '${id}' should load`);
  for (const k of keys) {
    assert.ok(
      p!.samples && p!.samples[k] !== undefined,
      `preset '${id}' should have sample '${k}'`,
    );
  }
}

console.log("preset-samples: ok");
