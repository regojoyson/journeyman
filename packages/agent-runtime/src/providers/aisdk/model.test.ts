import { describe, it, expect } from "vitest";
import { resolveModel, configError } from "./model.ts";

const fakeAnthropic = {
  createAnthropic: (o: { apiKey?: string; baseURL?: string }) => (id: string) => ({ vendor: "anthropic", id, key: o.apiKey }),
};
const fakeCompat = {
  createOpenAICompatible: (o: { baseURL?: string; apiKey?: string }) => (id: string) => ({ vendor: "compat", id, baseURL: o.baseURL }),
};

describe("resolveModel", () => {
  const importer = async (npm: string) => (npm === "@ai-sdk/anthropic" ? fakeAnthropic : fakeCompat);

  it("loads anthropic and passes the resolved api key", async () => {
    const m: any = await resolveModel(
      { modelId: "claude-sonnet-4-6", config: { npm: "@ai-sdk/anthropic", apiKeySlot: "ANTHROPIC_API_KEY" }, env: { ANTHROPIC_API_KEY: "sk-1" } },
      { importer },
    );
    expect(m).toMatchObject({ vendor: "anthropic", id: "claude-sonnet-4-6", key: "sk-1" });
  });

  it("errors when model is missing", async () => {
    await expect(resolveModel({ modelId: undefined, config: {} }, { importer })).rejects.toThrow(/requires a model/);
  });

  it("errors on an unsupported package", async () => {
    await expect(resolveModel({ modelId: "x", config: { npm: "@ai-sdk/cohere" } }, { importer })).rejects.toThrow(/Unsupported/);
  });

  it("errors when openai-compatible lacks baseUrl", async () => {
    await expect(resolveModel({ modelId: "x", config: { npm: "@ai-sdk/openai-compatible" } }, { importer })).rejects.toThrow(/baseUrl/);
  });

  it("configError carries the ConfigurationError name", () => {
    expect(configError("x").name).toBe("ConfigurationError");
  });
});
