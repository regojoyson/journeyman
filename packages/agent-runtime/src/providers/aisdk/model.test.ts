import { describe, it, expect } from "vitest";
import { resolveModel, configError } from "./model.ts";

const fakeAnthropic = {
  createAnthropic: (o: { apiKey?: string; baseURL?: string }) => (id: string) => ({ vendor: "anthropic", id, key: o.apiKey }),
};
const fakeCompat = {
  createOpenAICompatible: (o: { baseURL?: string; apiKey?: string; supportsStructuredOutputs?: boolean }) =>
    (id: string) => ({ vendor: "compat", id, baseURL: o.baseURL, key: o.apiKey, supportsStructuredOutputs: o.supportsStructuredOutputs }),
};

describe("resolveModel", () => {
  const importer = async (npm: string) => (npm === "@ai-sdk/anthropic" ? fakeAnthropic : fakeCompat);

  it("loads anthropic and passes the resolved api key from the derived label", async () => {
    const m: any = await resolveModel(
      { modelId: "claude-sonnet-4-6", config: { npm: "@ai-sdk/anthropic" }, env: { ANTHROPIC_API_KEY: "sk-1" } },
      { importer },
    );
    expect(m).toMatchObject({ vendor: "anthropic", id: "claude-sonnet-4-6", key: "sk-1" });
  });

  it("openai-compatible reads the key from the derived fallback label", async () => {
    const m: any = await resolveModel(
      {
        modelId: "MiniMax-M3",
        config: { npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1" },
        env: { AISDK_API_KEY: "sk-mini" },
      },
      { importer: async () => fakeCompat },
    );
    expect(m).toMatchObject({ vendor: "compat", id: "MiniMax-M3", key: "sk-mini" });
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

  it("enables structured outputs for openai-compatible (sends json_schema, not json_object)", async () => {
    const m: any = await resolveModel(
      { modelId: "qwen3-coder-next", config: { npm: "@ai-sdk/openai-compatible", baseUrl: "http://host.docker.internal:1234/v1" } },
      { importer },
    );
    expect(m).toMatchObject({ vendor: "compat", supportsStructuredOutputs: true });
  });

  it("configError carries the ConfigurationError name", () => {
    expect(configError("x").name).toBe("ConfigurationError");
  });
});
