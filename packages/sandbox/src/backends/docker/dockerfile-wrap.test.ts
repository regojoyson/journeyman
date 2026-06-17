import { describe, it, expect } from "vitest";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

describe("wrapDockerfile", () => {
  const out = wrapDockerfile("FROM eclipse-temurin:21\nRUN echo hi", "journeyman/runner-bundle:dev");

  it("keeps the user's content first", () => {
    expect(out.startsWith("FROM eclipse-temurin:21\nRUN echo hi")).toBe(true);
  });

  it("appends the runner bundle COPY and PATH", () => {
    expect(out).toContain("COPY --from=journeyman/runner-bundle:dev /opt/journeyman /opt/journeyman");
    expect(out).toContain("ENV PATH=/opt/journeyman/bin:$PATH");
  });

  it("appends a best-effort baseline-tools install", () => {
    expect(out).toMatch(/apt-get install -y[^\n]*git/);
    expect(out).toContain("|| true");
  });

  it("includes curl in the baseline-tools install", () => {
    expect(out).toMatch(/apt-get install -y[^\n]*curl/);
  });

  it("does not inject when the base is already the runner base", () => {
    const skipped = wrapDockerfile("FROM journeyman/runner-base:dev\nRUN x", "journeyman/runner-bundle:dev");
    expect(skipped).not.toContain("COPY --from=journeyman/runner-bundle");
  });
});
