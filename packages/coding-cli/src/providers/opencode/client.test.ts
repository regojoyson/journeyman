import assert from "node:assert/strict";
import { getClient } from "./client.ts";

// Test external mode — does not actually start a daemon, just creates HTTP client
{
  const client = await getClient({
    mode: "external",
    baseUrl: "http://localhost:4096",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  });
  assert.ok(client, "client should be returned for external mode");
  assert.ok(typeof client.session === "object", "client should have session namespace");
}

// Test external mode with default baseUrl
{
  const client = await getClient({
    mode: "external",
    model: { providerID: "openai", modelID: "gpt-4o" },
  });
  assert.ok(client, "client should be returned with default baseUrl");
}

console.log("getClient: all assertions passed");
