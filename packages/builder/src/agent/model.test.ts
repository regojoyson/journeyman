import { describe, it, expect } from "vitest";
import { resolveBuilderModel } from "./model.ts";

function fakeImporter() {
  const calls: any[] = [];
  const make = (name: string) => (opts: any) => {
    calls.push({ name, opts });
    return (modelId: string) => ({ provider: name, modelId, opts });
  };
  const importer = async (_npm: string) => ({
    createOpenAI: make("openai"),
    createAnthropic: make("anthropic"),
    createGoogleGenerativeAI: make("google"),
    createOpenAICompatible: make("compat"),
  });
  return { importer, calls };
}

describe("resolveBuilderModel", () => {
  it("builds an OpenAI model, passing apiKey/baseURL", async () => {
    const { importer, calls } = fakeImporter();
    const m: any = await resolveBuilderModel(
      { provider: "@ai-sdk/openai", model: "gpt-4o", apiKey: "k", baseUrl: "http://x" }, { importer });
    expect(m.provider).toBe("openai");
    expect(m.modelId).toBe("gpt-4o");
    expect(calls[0].opts).toEqual({ apiKey: "k", baseURL: "http://x" });
  });

  it("rejects an unknown provider package", async () => {
    await expect(resolveBuilderModel({ provider: "openai", model: "x" }, {} as never)).rejects.toThrow();
  });

  it("requires a model id", async () => {
    const { importer } = fakeImporter();
    await expect(resolveBuilderModel({ provider: "@ai-sdk/openai" }, { importer })).rejects.toThrow(/model/i);
  });

  it("requires baseUrl for the openai-compatible package", async () => {
    const { importer } = fakeImporter();
    await expect(resolveBuilderModel({ provider: "@ai-sdk/openai-compatible", model: "x" }, { importer })).rejects.toThrow(/base.?url/i);
  });
});
