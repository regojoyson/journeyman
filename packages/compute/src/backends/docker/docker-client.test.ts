import { describe, it, expect } from "vitest";
import { parseDockerHost } from "./docker-client.ts";

describe("parseDockerHost", () => {
  it("parses tcp://host:port", () => {
    expect(parseDockerHost("tcp://build-host:2376")).toEqual({ host: "build-host", port: 2376 });
  });
  it("parses host:port without a scheme", () => {
    expect(parseDockerHost("build-host:2375")).toEqual({ host: "build-host", port: 2375 });
  });
  it("defaults the port when omitted", () => {
    expect(parseDockerHost("build-host")).toEqual({ host: "build-host", port: 2375 });
  });
  it("strips an https scheme", () => {
    expect(parseDockerHost("https://h:2376")).toEqual({ host: "h", port: 2376 });
  });
});
