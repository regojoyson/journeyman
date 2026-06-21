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
import { defaultProviderForKind, PROVIDER_CATALOG, codingModelKeySlot } from "@journeyman/core";
import { findCodingModel } from "@journeyman/coding-models";
import { fetchSecretById } from "@journeyman/secrets";
import { resolveAgentLogLevel } from "./agent-log-level.ts";
import { SandboxInstanceCodingProvider } from "../../sandbox/sandbox-instance-coding-provider.ts";
import { placeSkills } from "../skill-placement.ts";
import { recordTokenUsage } from "../../usage/record-token-usage.ts";

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
    const model = typeof input.model === "string" && input.model ? input.model : undefined;
    // The model's API key is model-owned (bound to the coding model), injected
    // below — not a per-step required slot. So it is NOT declared here.
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

    // Inject the model-owned API key: the coding model binds an org secret
    // directly (same as agent-run). Resolve + merge into env under the derived label.
    if (provider && model && orgId) {
      try {
        const cm = await findCodingModel(this.deps.pool, orgId, provider, model);
        if (cm?.apiKeySecretId && cm.config?.requiresApiKey) {
          const value = await fetchSecretById(this.deps.pool, orgId, cm.apiKeySecretId);
          if (value != null) {
            const slot = codingModelKeySlot({ provider, config: cm.config, modelId: model });
            env[slot] = value;
          }
        }
      } catch (err: any) {
        log.warn({ err: err?.message }, "model key resolution failed; continuing without model-owned key");
      }
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

    // When running in a container (ctx.exec + ctx.materialize), deliver skills into the container
    // and rewrite localPath to the in-container location. For local runs, skills load from the
    // pantry path directly — no placement needed.
    if (ctx.exec && ctx.materialize && skills && skills.length) {
      ctx.log(`Delivering ${skills.length} skill(s) to workspace`);
      skills = await placeSkills(provider, skills, { materialize: ctx.materialize });
    }

    ctx.log(`Running custom step "${step.name}" (${step.outputMode})`);

    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const maxSteps = typeof input.maxSteps === "number" && input.maxSteps > 0 ? input.maxSteps : undefined;
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
      ...(maxSteps ? { maxSteps } : {}),
    });

    const outcome: "success" | "error" | "aborted" =
      ctx.signal.aborted ? "aborted" : result.error ? "error" : "success";
    let versionId: string | null = null;
    let wfName: string | null = null;
    try {
      const wi = await this.deps.pool.query(
        "SELECT workflow_version_id, workflow_name_snapshot FROM jm_workflow_instances WHERE id = $1",
        [ctx.workflowInstanceId],
      );
      versionId = wi.rows[0]?.workflow_version_id ?? null;
      wfName = wi.rows[0]?.workflow_name_snapshot ?? null;
    } catch { /* non-fatal */ }
    await recordTokenUsage(this.deps.pool, {
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : null,
      orgId, workflowId, workflowVersionId: versionId, workflowName: wfName,
      workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, stepType: this.stepType,
      stepName: step.name ?? null, attempt: ctx.attempt,
      agentId: typeof input.agentId === "string" ? input.agentId : null,
      agentName: typeof input.displayName === "string" ? input.displayName : null,
      triggeredByUserId: userId, outcome, provider: provider ?? "claude",
      requestedModel: model ?? null, usage: result.usage ?? [],
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
