import type { Pool } from "pg";
import {
  createLogger,
  toolsRequireWorkspace,
  type CanonicalTool,
  type ICodingCLI,
  type IStepHandler,
  type StepContext,
  type StepInput,
  type StepRunResult,
  type ResolvedMcpInstance,
  type ResolvedSkillPackage,
  type SecretBinding,
  type CodingModelConfig,
} from "@journeyman/core";
import { getCustomAiStep, renderPrompt, outputFieldsToJsonSchema } from "@journeyman/custom-steps";
import { defaultProviderForKind, PROVIDER_CATALOG, openCodeModelSlots } from "@journeyman/core";
import { resolveAgentLogLevel } from "./agent-log-level.ts";
import { SandboxInstanceCodingProvider } from "../../sandbox/sandbox-instance-coding-provider.ts";
import { placeSkills } from "../skill-placement.ts";

const log = createLogger("worker:custom-ai");

type CodingFactory = (key: string | undefined, env: Record<string, string>) => ICodingCLI;

type BindingResolver = (input: {
  ctx: { userId: string | null; orgId: string | null; workflowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}) => Promise<Record<string, string>>;

export class CustomAiStepHandler implements IStepHandler {
  readonly stepType = "custom-ai";
  // Workspace is demand-driven: needsWorkspaceFor() decides per invocation.
  readonly requiresWorkspace = false;

  constructor(private deps: { coding: CodingFactory; pool: Pool; bindingResolver: BindingResolver }) {}

  async needsWorkspaceFor(input: StepInput): Promise<boolean> {
    const customStepId = typeof input.customStepId === "string" ? input.customStepId : undefined;
    // Load the step from DB to check defaultTools (tools that might require workspace).
    const step = customStepId ? await getCustomAiStep(this.deps.pool, customStepId) : null;
    const effectiveTools: CanonicalTool[] = (
      Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) :
      (step?.defaultTools ?? [])
    );
    const hasSkills = Array.isArray(input.skills) && (input.skills as unknown[]).length > 0;
    const hasMcps = Array.isArray(input.mcps) && (input.mcps as unknown[]).length > 0;
    return toolsRequireWorkspace(effectiveTools) || hasSkills || hasMcps;
  }

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const customStepId = typeof input.customStepId === "string" ? input.customStepId : undefined;
    if (!customStepId) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "custom-ai step requires customStepId in node config",
          retryable: false,
        },
      };
    }

    const step = await getCustomAiStep(this.deps.pool, customStepId);
    if (!step) {
      return {
        kind: "failure",
        failure: {
          errorClass: "CustomStepNotFound",
          message: `custom step ${customStepId} not found`,
          retryable: false,
        },
      };
    }

    const fieldValues: Record<string, unknown> = {};
    for (const f of step.inputFields) fieldValues[f.name] = input[f.name];

    let prompt: string;
    try {
      prompt = renderPrompt(step, fieldValues);
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
    const effectiveTools: CanonicalTool[] = nodeTools ?? step.defaultTools ?? [];
    const needsWorkspace = toolsRequireWorkspace(effectiveTools);

    // ctx.workspaceDir is set by the harness when needsWorkspaceFor() returned true.
    // For tool-less steps it will be "" — that's fine, cwd is only used when needsWorkspace.
    const cwd = needsWorkspace && ctx.workspaceDir ? ctx.workspaceDir : undefined;

    const provider = typeof input.provider === "string"
      ? input.provider
      : defaultProviderForKind("coding-cli")?.value;

    const declaredBindings =
      (input.secretBindings as Record<string, SecretBinding> | undefined) ?? {};
    const userId =
      typeof input.startedByUserId === "string" ? input.startedByUserId : null;
    const orgId =
      typeof input.startedByOrgId === "string" ? input.startedByOrgId : null;
    const workflowId =
      typeof input.workflowId === "string" ? input.workflowId : null;

    const wantsContextResources =
      (Array.isArray(input.skills) && (input.skills as unknown[]).length > 0) ||
      (Array.isArray(input.mcps) && (input.mcps as unknown[]).length > 0);
    if (wantsContextResources && (!userId || !orgId)) {
      return {
        kind: "failure",
        failure: {
          errorClass: "MissingContext",
          message: "skills/MCP require user/org context on the run",
          retryable: false,
        },
      };
    }

    // Union DB-step slots with the executor provider's framework slots
    // (e.g. ANTHROPIC_API_KEY for coding-cli/claude). Custom-step slots win
    // on name collisions so a step author can override metadata.
    const providerSlots =
      PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === provider)?.slots ?? [];
    const dbSlots = step.slots ?? [];
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    for (const s of dbSlots)       slotsByName.set(s.name, s);
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    // OpenCode models declare their own required key slot; non-opencode → [].
    for (const s of openCodeModelSlots(modelConfig)) {
      slotsByName.set(s.name, { name: s.name, optional: s.optional });
    }
    const effectiveSlots = Array.from(slotsByName.values());

    let env: Record<string, string>;
    try {
      env = await this.deps.bindingResolver({
        ctx: { userId, orgId, workflowId },
        slots: effectiveSlots,
        bindings: declaredBindings,
      });
    } catch (err: any) {
      const missing: string[] = err?.missing ?? [];
      log.error({ stepId: step.id, missing }, "custom-ai secret resolution failed");
      return {
        kind: "failure",
        failure: {
          errorClass: err?.name === "MissingSecretsError" ? "MissingSecrets" : "SecretResolutionFailed",
          message: err?.message ?? String(err),
          retryable: false,
        },
      };
    }

    ctx.log(
      `Resolved ${Object.keys(env).length} secret slot(s): ` +
        (effectiveSlots
          .map(s => {
            const b = declaredBindings[s.name];
            const mode = b?.mode ?? "auto";
            const scope = b?.mode === "pinned" ? `:${b.scope}` : "";
            return `${s.name}=${mode}${scope}`;
          })
          .join(", ") || "(none)"),
    );

    const coding = ctx.exec
      ? new SandboxInstanceCodingProvider(ctx.exec, provider)
      : this.deps.coding(provider, ctx.env);

    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    let skills: ResolvedSkillPackage[] | undefined =
      Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;
    const model = typeof input.model === "string" && input.model ? input.model : undefined;

    // When running in a container (ctx.exec + ctx.materialize), deliver skills into the container
    // and rewrite localPath to the in-container location. For local runs, skills load from the
    // pantry path directly — no placement needed.
    if (ctx.exec && ctx.materialize && skills && skills.length) {
      ctx.log(`Delivering ${skills.length} skill(s) to workspace`);
      skills = await placeSkills(provider, skills, { materialize: ctx.materialize });
    }

    ctx.log(`Running custom step "${step.name}" (${step.outputMode})`);

    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const result = await coding.runCustomPrompt({
      prompt,
      outputMode: step.outputMode,
      outputSchema: step.outputMode === "structured"
        ? outputFieldsToJsonSchema(step.outputFields ?? [])
        : undefined,
      cwd,
      mcps,
      skills,
      tools: effectiveTools,
      env,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
      ...(model ? { model } : {}),
      ...(modelConfig ? { modelConfig } : {}),
    });

    if (result.error) {
      log.error({ stepId: step.id, err: result.error }, "custom-ai run failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "CustomStepFailed",
          message: result.error,
          retryable: true,
        },
      };
    }

    if (step.outputMode === "none") return { kind: "success", output: {} };
    if (step.outputMode === "text") return { kind: "success", output: { result: result.result ?? "" } };
    return { kind: "success", output: (result.structured as Record<string, unknown>) ?? {} };
  }
}
