import type { Pool } from "pg";
import {
  createLogger,
  toolsRequireWorkspace,
  type CanonicalTool,
  type ICodingCLI,
  type IPhaseHandler,
  type PhaseContext,
  type PhaseInput,
  type PhaseRunResult,
  type ResolvedMcpInstance,
  type ResolvedSkillPackage,
} from "@journeyman/core";
import { getCustomAiPhase, renderPrompt } from "@journeyman/custom-phases";
import { defaultProviderForKind } from "@journeyman/core";
import { resolveAgentLogLevel } from "./agent-log-level.ts";

const log = createLogger("worker:custom-ai");

type CodingFactory = (key: string | undefined, env: Record<string, string>) => ICodingCLI;

export class CustomAiPhaseHandler implements IPhaseHandler {
  readonly phaseType = "custom-ai";

  constructor(private deps: { coding: CodingFactory; pool: Pool }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const customPhaseId = typeof input.customPhaseId === "string" ? input.customPhaseId : undefined;
    if (!customPhaseId) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "custom-ai phase requires customPhaseId in node config",
          retryable: false,
        },
      };
    }

    const phase = await getCustomAiPhase(this.deps.pool, customPhaseId);
    if (!phase) {
      return {
        kind: "failure",
        failure: {
          errorClass: "CustomPhaseNotFound",
          message: `custom phase ${customPhaseId} not found`,
          retryable: false,
        },
      };
    }

    const fieldValues: Record<string, unknown> = {};
    for (const f of phase.inputFields) fieldValues[f.name] = input[f.name];

    let prompt: string;
    try {
      prompt = renderPrompt(phase, fieldValues);
    } catch (err: any) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: err?.message ?? String(err),
          retryable: false,
        },
      };
    }

    const nodeTools = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : undefined;
    const effectiveTools: CanonicalTool[] = nodeTools ?? phase.defaultTools ?? [];
    const needsWorkspace = toolsRequireWorkspace(effectiveTools);

    const cwd = needsWorkspace
      ? (typeof input.workspaceDir === "string" ? input.workspaceDir : undefined)
      : undefined;
    if (needsWorkspace && !cwd) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message:
            "Custom phase selected workspace tools (bash/read-file/write-file/edit-file/search) " +
            "but no workspaceDir input was wired",
          retryable: false,
        },
      };
    }

    const provider = typeof input.provider === "string"
      ? input.provider
      : defaultProviderForKind("coding-cli")?.value;
    const coding = this.deps.coding(provider, ctx.env);

    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const skills = Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;
    const model = typeof input.model === "string" && input.model ? input.model : undefined;

    ctx.log(`Running custom phase "${phase.name}" (${phase.outputMode})`);

    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const result = await coding.runCustomPrompt({
      prompt,
      outputMode: phase.outputMode,
      outputSchema: phase.outputSchema,
      cwd,
      mcps,
      skills,
      tools: effectiveTools,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
      ...(model ? { model } : {}),
    });

    if (result.error) {
      log.error({ phaseId: phase.id, err: result.error }, "custom-ai run failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "CustomPhaseFailed",
          message: result.error,
          retryable: true,
        },
      };
    }

    if (phase.outputMode === "none") return { kind: "success", output: {} };
    if (phase.outputMode === "text") return { kind: "success", output: { result: result.result ?? "" } };
    return { kind: "success", output: (result.structured as Record<string, unknown>) ?? {} };
  }
}
