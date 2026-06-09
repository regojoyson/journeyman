import { describe, it, expect } from "vitest";
import { registryAuthFromEnv, registryHost } from "./registry-auth.ts";

describe("registry-auth", () => {
  it("registryHost strips the path from the prefix", () => {
    expect(registryHost("ghcr.io/acme")).toBe("ghcr.io");
    expect(registryHost("localhost:5000")).toBe("localhost:5000");
    expect(registryHost("registry.gitlab.com/acme/journeyman")).toBe("registry.gitlab.com");
  });

  it("returns undefined when no token is set", () => {
    expect(registryAuthFromEnv({ JOURNEYMAN_REGISTRY: "ghcr.io/acme" })).toBeUndefined();
  });

  it("builds an authconfig when username + token are set", () => {
    expect(registryAuthFromEnv({
      JOURNEYMAN_REGISTRY: "ghcr.io/acme",
      JOURNEYMAN_REGISTRY_USERNAME: "bot",
      JOURNEYMAN_REGISTRY_TOKEN: "secret",
    })).toEqual({ username: "bot", password: "secret", serveraddress: "ghcr.io" });
  });

  it("defaults username to empty string when only a token is set (token-only registries)", () => {
    expect(registryAuthFromEnv({
      JOURNEYMAN_REGISTRY: "localhost:5000",
      JOURNEYMAN_REGISTRY_TOKEN: "t",
    })).toEqual({ username: "", password: "t", serveraddress: "localhost:5000" });
  });
});
