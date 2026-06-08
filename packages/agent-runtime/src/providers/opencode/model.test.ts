import { describe, it, expect } from "vitest";
import { parseOpenCodeModel, resolveOpenCodeModel } from "./model.ts";

describe("parseOpenCodeModel", () => {
  it("splits 'providerID/modelID' on the first slash", () => {
    expect(parseOpenCodeModel("anthropic/claude-sonnet-4-6")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" });
  });
  it("keeps later slashes inside the modelID", () => {
    expect(parseOpenCodeModel("openrouter/meta/llama-3.1")).toEqual({ providerID: "openrouter", modelID: "meta/llama-3.1" });
  });
  it("returns undefined for a string without a slash", () => {
    expect(parseOpenCodeModel("claude-sonnet-4-6")).toBeUndefined();
  });
  it("returns undefined for empty/undefined", () => {
    expect(parseOpenCodeModel("")).toBeUndefined();
    expect(parseOpenCodeModel(undefined)).toBeUndefined();
  });
});

describe("resolveOpenCodeModel", () => {
  it("prefers the per-call model string", () => {
    expect(resolveOpenCodeModel("openai/gpt-4o", { providerID: "anthropic", modelID: "x" }))
      .toEqual({ providerID: "openai", modelID: "gpt-4o" });
  });
  it("falls back to the config model", () => {
    expect(resolveOpenCodeModel(undefined, { providerID: "anthropic", modelID: "x" }))
      .toEqual({ providerID: "anthropic", modelID: "x" });
  });
  it("returns undefined when neither is set", () => {
    expect(resolveOpenCodeModel(undefined, undefined)).toBeUndefined();
  });
});
