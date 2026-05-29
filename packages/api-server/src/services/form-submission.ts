import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type {
  TriggerHumanConfig,
  TriggerHumanFieldWidget,
  Workflow,
  WorkflowGraph,
  WorkflowInputDef,
  WorkflowNode,
} from "@journeyman/core";
import type { Composition } from "../composition.ts";

export interface ResolvedFormField {
  name: string;
  type: WorkflowInputDef["type"];
  required: boolean;
  label: string;
  description?: string;
  widget: TriggerHumanFieldWidget;
  options?: string[];
}

export interface ResolvedFormSchema {
  workflowId: string;
  workflowVersionId: string;
  title: string;
  fields: ResolvedFormField[];
}

function pickHumanTrigger(graph: WorkflowGraph): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.type === "trigger-human");
}

function defaultWidgetFor(type: WorkflowInputDef["type"]): TriggerHumanFieldWidget {
  switch (type) {
    case "number":      return "number";
    case "boolean":     return "checkbox";
    case "json-object": return "textarea";
    case "json-array":  return "textarea";
    case "string":
    default:            return "text";
  }
}

export function resolveFormSchema(
  workflow: Workflow,
  version: { id: string; definition: WorkflowGraph },
): ResolvedFormSchema | null {
  const trigger = pickHumanTrigger(version.definition);
  if (!trigger) return null;
  const cfg = (trigger.config ?? {}) as TriggerHumanConfig;
  const overrides = cfg.fieldOverrides ?? {};
  const declared = version.definition.inputDefs ?? [];

  const fields: ResolvedFormField[] = declared.map((inp) => {
    const o = overrides[inp.name] ?? {};
    return {
      name: inp.name,
      type: inp.type,
      required: inp.required === true,
      label: o.label ?? inp.name,
      description: o.description ?? inp.description,
      widget: o.widget ?? defaultWidgetFor(inp.type),
      options: o.options,
    };
  });

  return {
    workflowId: workflow.id,
    workflowVersionId: version.id,
    title: cfg.formTitle ?? workflow.name,
    fields,
  };
}

function coerceInput(value: unknown, type: WorkflowInputDef["type"]): unknown {
  if (value == null) return value;
  switch (type) {
    case "number":      return typeof value === "number" ? value : Number(value);
    case "boolean":     return Boolean(value);
    case "json-object": return typeof value === "string" ? JSON.parse(value) : value;
    case "json-array":  return typeof value === "string" ? JSON.parse(value) : value;
    case "string":
    default:            return String(value);
  }
}

export interface FormSubmitArgs {
  workflow: Workflow;
  version: { id: string; definition: WorkflowGraph };
  submittedByUserId: string | null;
  startedByOrgId: string | null;
  values: Record<string, unknown>;
}

export interface FormSubmitResult {
  workflowInstanceId: string;
  formSubmissionId: string;
}

export async function submitForm(
  c: Composition,
  pool: Pool | null,
  args: FormSubmitArgs,
): Promise<FormSubmitResult> {
  const trigger = pickHumanTrigger(args.version.definition);
  if (!trigger) throw new Error("workflow has no trigger-human node");

  const declared = args.version.definition.inputDefs ?? [];
  const errors: string[] = [];
  const coerced: Record<string, unknown> = {};
  for (const inp of declared) {
    const raw = args.values[inp.name];
    if (raw == null || raw === "") {
      if (inp.required) errors.push(`missing required input "${inp.name}"`);
      continue;
    }
    try {
      coerced[inp.name] = coerceInput(raw, inp.type);
    } catch (e) {
      errors.push(`invalid value for "${inp.name}": ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));

  const submissionId = randomUUID();
  if (pool) {
    await pool.query(
      `INSERT INTO jm_form_submissions
         (id, workflow_id, workflow_version_id, submitted_by_user_id, raw_values)
       VALUES ($1, $2, $3, $4, $5)`,
      [submissionId, args.workflow.id, args.version.id, args.submittedByUserId, coerced],
    );
  }

  const { workflowInstanceId } = await c.orchestrator.submit({
    workflowId: args.workflow.id,
    workflowVersionId: args.version.id,
    workflowNameSnapshot: args.workflow.name,
    workflowScopeSnapshot: args.workflow.scope,
    definitionSnapshot: args.version.definition,
    inputs: coerced,
    startedByUserId: args.submittedByUserId,
    startedByOrgId: args.startedByOrgId,
    triggerSource: "human",
    triggerNodeId: trigger.id,
    formSubmissionId: submissionId,
  });

  if (pool) {
    await pool.query(
      `UPDATE jm_form_submissions SET workflow_instance_id = $1 WHERE id = $2`,
      [workflowInstanceId, submissionId],
    );
  }

  return { workflowInstanceId, formSubmissionId: submissionId };
}
