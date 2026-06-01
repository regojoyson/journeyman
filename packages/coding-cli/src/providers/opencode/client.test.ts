import { describe, it, expect } from "vitest";
import { getClient } from "./client.ts";

// External mode does not start a daemon — it only constructs an HTTP client.
describe("getClient (opencode, external mode)", () => {
  it("returns an HTTP client with a session namespace", async () => {
    const client = await getClient({
      mode: "external",
      baseUrl: "http://localhost:4096",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    });
    expect(client).toBeTruthy();
    expect(typeof client.session).toBe("object");
  });

  it("uses a default baseUrl when none is provided", async () => {
    const client = await getClient({
      mode: "external",
      model: { providerID: "openai", modelID: "gpt-4o" },
    });
    expect(client).toBeTruthy();
  });
});
