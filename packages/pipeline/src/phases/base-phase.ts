/**
 * @file base-phase.ts
 * Abstract base class for all pipeline phases.
 *
 * Provides:
 * - `ok(artifacts)`    — returns a successful PhaseResult and merges artifacts into ctx.
 * - `blocked(reason)`  — halts the run pending human or external action.
 * - `failed(msg)`      — marks the step as errored; runner applies onFailure policy.
 * - `require<T>(key)`  — reads a required artifact from ctx; throws if absent.
 * - `optional<T>(key)` — reads an optional artifact; returns undefined if absent.
 *
 * Every concrete phase must declare `static reads` and `static writes` so the
 * FlowValidator can check the artifact dependency graph at boot without running phases.
 * The `BasePhaseStatic` interface captures this contract for the validator.
 */

import type { IPhase, PhaseResult, PipelineContext } from "@journeyman/core";

/** Static shape every concrete phase class exposes. Used by the flow validator. */
export interface BasePhaseStatic {
  reads?: readonly string[];
  writes?: readonly string[];
}

export abstract class BasePhase implements IPhase {
  abstract readonly name: string;
  static reads: readonly string[] = [];
  static writes: readonly string[] = [];

  abstract run(ctx: PipelineContext, config: unknown): Promise<PhaseResult>;

  protected ok(artifacts: Record<string, unknown>): PhaseResult {
    return { status: "ok", artifacts };
  }

  protected blocked(
    reason: string,
    waitFor?: "ticket-comment" | "pr-comment" | "manual",
  ): PhaseResult {
    return { status: "blocked", reason, waitFor };
  }

  protected failed(message: string, code?: string): PhaseResult {
    return { status: "failed", error: { message, code } };
  }

  protected require<T>(ctx: PipelineContext, key: string): T {
    const v = ctx.artifacts[key];
    if (v === undefined) throw new Error(`${this.name}: missing required artifact "${key}"`);
    return v as T;
  }

  protected optional<T>(ctx: PipelineContext, key: string): T | undefined {
    return ctx.artifacts[key] as T | undefined;
  }
}
