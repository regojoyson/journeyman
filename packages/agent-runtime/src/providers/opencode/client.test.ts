import { describe, it, expect } from "vitest";
import { startServer } from "./client.ts";

// External mode does not spawn a daemon — it only constructs an HTTP client.
describe("startServer (opencode, external mode)", () => {
  it("returns a client with a session namespace and a no-op close", async () => {
    const handle = await startServer(
      { mode: "external", baseUrl: "http://localhost:4096", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
      { permission: {} },
      undefined,
    );
    expect(handle.client).toBeTruthy();
    expect(typeof handle.client.session).toBe("object");
    expect(typeof handle.close).toBe("function");
    handle.close(); // must not throw
  });

  it("uses a default baseUrl when none is provided", async () => {
    const handle = await startServer(
      { mode: "external", model: { providerID: "openai", modelID: "gpt-4o" } },
      { permission: {} },
      undefined,
    );
    expect(handle.client).toBeTruthy();
    handle.close();
  });
});
