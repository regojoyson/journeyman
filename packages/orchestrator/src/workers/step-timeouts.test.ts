import { describe, it, expect } from "vitest";
import {
  resolveImageRetryConfig,
  resolveCapacityRetryConfig,
  resolveDefaultStepTimeoutSeconds,
  resolveImageWaitBudgetSeconds,
  resolveConductorTaskTimeoutSeconds,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  DEFAULT_IMAGE_RETRY_ATTEMPTS,
  DEFAULT_IMAGE_RETRY_DELAY_MS,
  DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS,
} from "./step-timeouts.ts";

// Default capacity wait budget folded into the Conductor backstop: 5 × 10_000ms = 50s.
const CAP = 50;

describe("resolveCapacityRetryConfig", () => {
  it("defaults to a moderate budget", () => {
    expect(resolveCapacityRetryConfig({})).toEqual({ attempts: 5, delayMs: 10_000 });
  });
  it("reads env overrides", () => {
    expect(resolveCapacityRetryConfig({
      SANDBOX_CAPACITY_RETRY_ATTEMPTS: "2", SANDBOX_CAPACITY_RETRY_DELAY_MS: "1000",
    } as NodeJS.ProcessEnv)).toEqual({ attempts: 2, delayMs: 1000 });
  });
});

describe("resolveImageRetryConfig", () => {
  it("defaults when unset", () => {
    expect(resolveImageRetryConfig({})).toEqual({
      attempts: DEFAULT_IMAGE_RETRY_ATTEMPTS,
      delayMs: DEFAULT_IMAGE_RETRY_DELAY_MS,
    });
  });

  it("reads overrides, including 0 to fast-fail", () => {
    expect(
      resolveImageRetryConfig({ WORKER_IMAGE_RETRY_ATTEMPTS: "0", WORKER_IMAGE_RETRY_DELAY_MS: "0" }),
    ).toEqual({ attempts: 0, delayMs: 0 });
  });

  it("falls back on non-numeric / negative junk", () => {
    expect(
      resolveImageRetryConfig({ WORKER_IMAGE_RETRY_ATTEMPTS: "abc", WORKER_IMAGE_RETRY_DELAY_MS: "-5" }),
    ).toEqual({ attempts: DEFAULT_IMAGE_RETRY_ATTEMPTS, delayMs: DEFAULT_IMAGE_RETRY_DELAY_MS });
  });
});

describe("resolveDefaultStepTimeoutSeconds", () => {
  it("defaults when unset", () => {
    expect(resolveDefaultStepTimeoutSeconds({})).toBe(DEFAULT_STEP_TIMEOUT_SECONDS);
  });
  it("reads a valid override", () => {
    expect(resolveDefaultStepTimeoutSeconds({ WORKER_DEFAULT_STEP_TIMEOUT_S: "600" })).toBe(600);
  });
  it("falls back on non-positive (a 0 deadline would disable the safety net)", () => {
    expect(resolveDefaultStepTimeoutSeconds({ WORKER_DEFAULT_STEP_TIMEOUT_S: "0" })).toBe(
      DEFAULT_STEP_TIMEOUT_SECONDS,
    );
  });
});

describe("resolveImageWaitBudgetSeconds", () => {
  it("multiplies attempts × delay (default 10 × 30s = 300s)", () => {
    expect(resolveImageWaitBudgetSeconds({})).toBe(300);
  });
  it("is 0 when retries are disabled", () => {
    expect(resolveImageWaitBudgetSeconds({ WORKER_IMAGE_RETRY_ATTEMPTS: "0" })).toBe(0);
  });
});

describe("resolveConductorTaskTimeoutSeconds", () => {
  it("is a backstop larger than image wait + step work (defaults)", () => {
    // 1800 (step) + 300 (image wait) + 50 (capacity wait) + 120 (margin)
    expect(resolveConductorTaskTimeoutSeconds({ env: {} })).toBe(
      DEFAULT_STEP_TIMEOUT_SECONDS + 300 + CAP + DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS,
    );
  });

  it("raises the backstop when a per-step override exceeds the worker default", () => {
    // a long-running node (3600s of work) gets image-wait + capacity headroom on top
    expect(resolveConductorTaskTimeoutSeconds({ stepTimeoutSeconds: 3600, env: {} })).toBe(
      3600 + 300 + CAP + DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS,
    );
  });

  it("floors at the worker default for a shorter or junk override", () => {
    // worker still enforces ≥ default, so the backstop must too
    for (const override of [600, 0]) {
      expect(resolveConductorTaskTimeoutSeconds({ stepTimeoutSeconds: override, env: {} })).toBe(
        DEFAULT_STEP_TIMEOUT_SECONDS + 300 + CAP + DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS,
      );
    }
  });

  it("tracks the image-wait knobs so the backstop grows with the wait", () => {
    // attempts 20 × 30s = 600s image wait
    expect(
      resolveConductorTaskTimeoutSeconds({
        stepTimeoutSeconds: 3600,
        env: { WORKER_IMAGE_RETRY_ATTEMPTS: "20" },
      }),
    ).toBe(3600 + 600 + CAP + DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS);
  });
});
