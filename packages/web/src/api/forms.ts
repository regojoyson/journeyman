import { api } from "./client.ts";

export interface FormListItem {
  workflowId: string;
  name: string;
  title: string;
}

export interface FormField {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required: boolean;
  label: string;
  description?: string;
  widget: "text" | "textarea" | "number" | "checkbox" | "select";
  options?: string[];
}

export interface FormSchema {
  workflowId: string;
  workflowVersionId: string;
  title: string;
  fields: FormField[];
}

export async function listMyForms(): Promise<FormListItem[]> {
  const res = await api<{ forms: FormListItem[] }>(`/me/forms`);
  return res.forms;
}

export async function getForm(workflowId: string): Promise<FormSchema> {
  const res = await api<{ form: FormSchema }>(`/workflows/${encodeURIComponent(workflowId)}/form`);
  return res.form;
}

export function submitForm(
  workflowId: string,
  values: Record<string, unknown>,
): Promise<{ workflowInstanceId: string; formSubmissionId: string }> {
  return api<{ workflowInstanceId: string; formSubmissionId: string }>(
    `/workflows/${encodeURIComponent(workflowId)}/form-submissions`,
    { method: "POST", body: JSON.stringify({ values }) },
  );
}
