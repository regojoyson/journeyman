import type {
  BuildPlan, CustomAiStepCreateInput, CreateWorkflowArgs,
} from "@journeyman/core";
import { rewriteCustomStepIds } from "./rewrite.ts";

/** Injected effects, so the executor is testable without a DB/orchestrator. */
export interface ApplyDeps {
  /** Create one custom step; returns at least its new id. */
  insertStep(
    input: CustomAiStepCreateInput & { workspaceId: string; createdBy: string },
  ): Promise<{ id: string }>;
  /** Hard-delete a created step (rollback). */
  deleteStep(id: string): Promise<void>;
  /** Create the draft workflow; returns the new workflow + version ids. */
  createWorkflow(args: CreateWorkflowArgs): Promise<{ workflowId: string; versionId: string }>;
}

export interface ApplyArgs {
  plan: BuildPlan;
  workflowName: string;
  createdBy: string | null;
  workspaceId: string;
}

export interface ApplyResult {
  workflowId: string;
  versionId: string;
  createdStepIds: string[];
  placeholderToRealId: Record<string, string>;
}

/**
 * Apply an approved BuildPlan: create new custom steps, rewrite the graph to
 * reference their real ids, then create the workflow as a draft. On any failure
 * after steps were created, delete them (newest first) and rethrow. Never
 * publishes or runs.
 */
export async function applyBuildPlan(deps: ApplyDeps, args: ApplyArgs): Promise<ApplyResult> {
  const { plan } = args;
  const createdStepIds: string[] = [];
  const placeholderToRealId: Record<string, string> = {};

  try {
    // 1. Create each new custom step, capturing placeholder → real id.
    for (const proposed of plan.newCustomSteps) {
      const created = await deps.insertStep({
        ...proposed.step,
        workspaceId: args.workspaceId,
        createdBy: args.createdBy ?? "",
      });
      createdStepIds.push(created.id);
      placeholderToRealId[proposed.id] = created.id;
    }

    // 2. Rewrite the graph to reference the real ids.
    const definition = rewriteCustomStepIds(plan.workflow, placeholderToRealId);

    // 3. Create the draft workflow (draft is the DB default — never publish).
    const { workflowId, versionId } = await deps.createWorkflow({
      workspaceId: args.workspaceId,
      name: args.workflowName,
      initialDefinition: definition,
      createdByUserId: args.createdBy,
    });

    return { workflowId, versionId, createdStepIds, placeholderToRealId };
  } catch (err) {
    // Rollback created steps, newest first; swallow rollback errors so the
    // original failure is what surfaces.
    for (const id of [...createdStepIds].reverse()) {
      try { await deps.deleteStep(id); } catch { /* best-effort rollback */ }
    }
    throw err;
  }
}
