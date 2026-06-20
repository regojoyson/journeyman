import { describe, it, expect, vi } from "vitest";

vi.mock("@journeyman/custom-steps", () => ({
  getCustomAiStep: vi.fn().mockResolvedValue({
    id: "cs1", name: "s", inputFields: [], defaultTools: [], slots: [],
    outputMode: "text", outputFields: [],
  }),
  renderPrompt: () => "rendered prompt",
  outputFieldsToJsonSchema: () => ({}),
}));
vi.mock("@journeyman/coding-models", () => ({
  findCodingModel: vi.fn().mockResolvedValue({
    apiKeySecretId: "sec1",
    config: { requiresApiKey: true, npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1" },
  }),
}));
vi.mock("@journeyman/secrets", () => ({
  fetchSecretById: vi.fn().mockResolvedValue("sk-minimax"),
  open: () => "tok",
}));

import { CustomAiStepHandler } from "./custom-ai-step-handler.ts";

function ctx(over: Partial<any> = {}): any {
  return {
    workflowInstanceId: "wi1", nodeId: "n1", attempt: 1, workspaceDir: "",
    signal: new AbortController().signal, env: {}, workflowInputs: {},
    log: vi.fn(), ...over,
  };
}

describe("CustomAiStepHandler model-owned key", () => {
  it("injects the model-bound secret into env under the derived label (like agent-run)", async () => {
    const runCustomPrompt = vi.fn().mockResolvedValue({ result: "ok" });
    const h = new CustomAiStepHandler({
      coding: () => ({ runCustomPrompt }),
      pool: {} as any,
      bindingResolver: vi.fn().mockResolvedValue({}),
    } as any);
    const res = await h.run(
      {
        customStepId: "cs1",
        provider: "aisdk",
        model: "MiniMax-M3",
        modelConfig: { npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1", requiresApiKey: true },
        startedByOrgId: "org1",
        outputMode: "text",
        tools: [],
      } as any,
      ctx(),
    );
    expect(res.kind).toBe("success");
    expect(runCustomPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining({ AISDK_API_KEY: "sk-minimax" }) }),
    );
  });
});
