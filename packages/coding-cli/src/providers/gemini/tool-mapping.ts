import type { ProviderToolMap } from "@journeyman/core";

// Stub map — every tool is currently unsupported on Gemini until the adapter
// lands. The flow editor uses null entries to flag node configs as broken
// when the user picks Gemini with these tools selected.
export const GEMINI_TOOL_MAP: ProviderToolMap = {
  "bash":       null,
  "read-file":  null,
  "write-file": null,
  "edit-file":  null,
  "search":     null,
  "web-fetch":  null,
  "web-search": null,
};
