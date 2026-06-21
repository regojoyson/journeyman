import type { Pool } from "pg";
import {
  createLogger,
  toolsRequireWorkspace,
  parseRepoList,
  type CanonicalTool,
  type ICodingCLI,
  type IGitProvider,
  type ProviderFactory,
  type IStepHandler,
  type StepContext,
  type StepInput,
  type StepRunResult,
  type ResolvedMcpInstance,
  type ResolvedSkillPackage,
  type SecretBinding,
  type CodingModelConfig,
  PROVIDER_CATALOG,
  defaultProviderForKind,
  codingModelKeySlot,
} from "@journeyman/core";
import { SandboxInstanceCodingProvider } from "../../sandbox/sandbox-instance-coding-provider.ts";
import { SandboxInstanceGitProvider, type SandboxGitAuth } from "../../sandbox/sandbox-instance-git-provider.ts";
import { placeSkills } from "../skill-placement.ts";
import { resolveAgentLogLevel } from "./agent-log-level.ts";
import { getConnection, getConnectionSealed } from "@journeyman/connections";
import { open, fetchSecretById } from "@journeyman/secrets";
import { findCodingModel } from "@journeyman/coding-models";
import { addUsage } from "@journeyman/agents";
import { recordTokenUsage } from "../../usage/record-token-usage.ts";

const log = createLogger("worker:agent-run");

type CodingFactory = (key: string | undefined, env: Record<string, string>) => ICodingCLI;
type BindingResolver = (input: {
  ctx: { userId: string | null; orgId: string | null; workflowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}) => Promise<Record<string, string>>;

export class AgentRunStepHandler implements IStepHandler {
  readonly stepType = "agent-run";
  readonly requiresWorkspace = false;

  constructor(
    private deps: {
      coding: CodingFactory;
      git: ProviderFactory<IGitProvider>;
      pool: Pool;
      bindingResolver: BindingResolver;
    },
  ) {}

  async needsWorkspaceFor(input: StepInput): Promise<boolean> {
    const tools = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : [];
    const hasRepos = parseRepoList(input.repos as string | string[] | undefined).length > 0;
    const hasSkills = Array.isArray(input.skills) && (input.skills as unknown[]).length > 0;
    const hasMcps = Array.isArray(input.mcps) && (input.mcps as unknown[]).length > 0;
    return hasRepos || toolsRequireWorkspace(tools) || hasSkills || hasMcps;
  }

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
    if (!instructions) {
      return {
        kind: "failure",
        failure: { errorClass: "InvalidInput", message: "agent-run requires instructions", retryable: false },
      };
    }

    const provider = typeof input.provider === "string" ? input.provider : defaultProviderForKind("coding-cli")?.value;
    const tools: CanonicalTool[] = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : [];
    const needsWorkspace = await this.needsWorkspaceFor(input);
    const cwd = needsWorkspace && ctx.workspaceDir ? ctx.workspaceDir : undefined;

    // 1) Clone repos (if any) into the workspace. When a git Connection is named,
    //    resolve its token and authenticate the clone (works in-container via URL).
    const repos = parseRepoList(input.repos as string | string[] | undefined);
    if (repos.length > 0) {
      const gitConnectionId = typeof input.gitConnectionId === "string" ? input.gitConnectionId : undefined;
      let auth: SandboxGitAuth | undefined;
      let gitProviderKey = provider;
      let cloneEnv = ctx.env;
      if (gitConnectionId) {
        const conn = await getConnection(this.deps.pool, gitConnectionId);
        const sealed = await getConnectionSealed(this.deps.pool, gitConnectionId);
        if (conn && sealed) {
          const token = open(sealed);
          gitProviderKey = conn.provider;
          auth = { provider: conn.provider, token, baseUrl: conn.baseUrl };
          cloneEnv =
            conn.provider === "gitlab"
              ? { ...ctx.env, GITLAB_TOKEN: token, GITLAB_BASE_URL: conn.baseUrl ?? "" }
              : { ...ctx.env, GITHUB_ACCESS_TOKEN: token };
        }
      }
      const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
        ? new SandboxInstanceGitProvider(ctx.exec, auth)
        : this.deps.git(gitProviderKey, cloneEnv);
      const branch = typeof input.repoBranch === "string" ? input.repoBranch : undefined;
      for (const r of repos) ctx.log(`Cloning ${r}…`);
      const cloneRes = await git.cloneRepos({ repos, workspaceDir: ctx.workspaceDir, branch, signal: ctx.signal });
      if (cloneRes?.error) {
        return {
          kind: "failure",
          failure: { errorClass: "CloneReposFailed", message: String(cloneRes.error), retryable: true },
        };
      }
    }

    // 2) Resolve secret slots (provider framework slots + model slots).
    const userId = typeof input.startedByUserId === "string" ? input.startedByUserId : null;
    const orgId = typeof input.startedByOrgId === "string" ? input.startedByOrgId : null;
    const workflowId = typeof input.workflowId === "string" ? input.workflowId : null;
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    const declaredBindings = (input.secretBindings as Record<string, SecretBinding> | undefined) ?? {};

    const providerSlots = PROVIDER_CATALOG.find((p) => p.kind === "coding-cli" && p.value === provider)?.slots ?? [];
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    const effectiveSlots = Array.from(slotsByName.values());

    let env: Record<string, string>;
    try {
      env = await this.deps.bindingResolver({
        ctx: { userId, orgId, workflowId },
        slots: effectiveSlots,
        bindings: declaredBindings,
      });
    } catch (err: any) {
      return {
        kind: "failure",
        failure: { errorClass: "SecretResolutionFailed", message: err?.message ?? String(err), retryable: false },
      };
    }

    // Inject the model-owned API key: the coding model binds an org secret directly,
    // so the per-step binding no longer carries it. Resolve + merge into the env.
    const model = typeof input.model === "string" && input.model ? input.model : undefined;
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

    // 3) Run the agentic loop.
    const coding = ctx.exec ? new SandboxInstanceCodingProvider(ctx.exec, provider) : this.deps.coding(provider, ctx.env);
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    let skills: ResolvedSkillPackage[] | undefined = Array.isArray(input.skills)
      ? (input.skills as ResolvedSkillPackage[])
      : undefined;
    const outputMode = (input.outputMode as "none" | "text" | "structured") ?? "text";
    const maxSteps = typeof input.maxSteps === "number" && input.maxSteps > 0 ? input.maxSteps : undefined;

    if (ctx.exec && ctx.materialize && skills && skills.length) {
      skills = await placeSkills(provider, skills, { materialize: ctx.materialize });
    }

    ctx.log(`Running agent "${(input.displayName as string) ?? "agent"}" (${outputMode})`);
    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const result = await coding.runCustomPrompt({
      prompt: instructions,
      outputMode,
      outputSchema: outputMode === "structured" ? (input.outputSchema as Record<string, unknown> | undefined) : undefined,
      cwd,
      mcps,
      skills,
      tools,
      env,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(model ? { model } : {}),
      ...(modelConfig ? { modelConfig } : {}),
      ...(maxSteps ? { maxSteps } : {}),
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
    });

    const outcome: "success" | "error" | "aborted" =
      ctx.signal.aborted ? "aborted" : result.error ? "error" : "success";
    const agentId = typeof input.agentId === "string" ? input.agentId : null;
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
    const insertedRows = await recordTokenUsage(this.deps.pool, {
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : null,
      orgId, workflowId, workflowVersionId: versionId, workflowName: wfName,
      workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, stepType: this.stepType,
      stepName: typeof input.displayName === "string" ? input.displayName : null, attempt: ctx.attempt,
      agentId, agentName: typeof input.displayName === "string" ? input.displayName : null,
      triggeredByUserId: userId, outcome, provider: provider ?? "claude",
      requestedModel: model ?? null, usage: result.usage ?? [],
    });
    if (insertedRows > 0 && agentId && orgId) {
      const totalTokens = (result.usage ?? []).reduce((s, u) => s + (u.totalTokens ?? 0), 0);
      await addUsage(this.deps.pool, orgId, agentId, totalTokens, 0).catch(() => undefined);
    }

    if (result.error) {
      log.error({ err: result.error }, "agent-run failed");
      return { kind: "failure", failure: { errorClass: "AgentRunFailed", message: result.error, retryable: true } };
    }
    if (outputMode === "none") return { kind: "success", output: {} };
    if (outputMode === "text") return { kind: "success", output: { result: result.result ?? "" } };
    return { kind: "success", output: (result.structured as Record<string, unknown>) ?? {} };
  }
}
