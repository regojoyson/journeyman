import { useState } from "react";
import type { WebhookAuthConfig } from "@journeyman/core";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { inferSchemaFromSample } from "./inferSchemaFromSample.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface ConfigFormValue {
  name: string;
  description: string;
  auth: WebhookAuthConfig;
  payloadSchema?: unknown;
  schemaInferredFrom?: string;
  schemaValidation: "off" | "warn" | "reject";
  eventTypePath?: string;
  deliveryIdHeader?: string;
}

interface Props {
  preset: WebhookPresetSummary;
  initial?: Partial<ConfigFormValue>;
  submitLabel?: string;
  onSubmit: (value: ConfigFormValue) => void | Promise<void>;
  busy?: boolean;
  /** Scope of the webhook being created. Drives the secret list and create endpoint. */
  scope: "org" | "user";
  /** Active org id (required by both list and create endpoints). */
  orgId: string;
  /** Whether the current user is an org admin (controls promote UI). */
  isAdmin: boolean;
}

export function WebhookConfigForm({ preset, initial, submitLabel = "Create webhook", onSubmit, busy, scope, orgId, isAdmin }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [secretRefInput, setSecretRefInput] = useState<string>(refOf(initial?.auth ?? preset.auth));
  const [schemaValidation, setSchemaValidation] = useState<"off" | "warn" | "reject">(initial?.schemaValidation ?? "off");
  const [sample, setSample] = useState(initial?.schemaInferredFrom ?? "");
  const [schemaText, setSchemaText] = useState<string>(
    initial?.payloadSchema ? JSON.stringify(initial.payloadSchema, null, 2) : "",
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);

  function inferFromSample() {
    setSchemaError(null);
    try {
      const parsed = JSON.parse(sample);
      const inferred = inferSchemaFromSample(parsed);
      setSchemaText(JSON.stringify(inferred, null, 2));
    } catch (err) {
      setSchemaError(`Sample not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSchemaError(null);

    let parsedSchema: unknown = undefined;
    if (schemaText.trim()) {
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch (err) {
        setSchemaError(`Schema not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    const auth = withRef(initial?.auth ?? preset.auth, secretRefInput);

    void onSubmit({
      name,
      description,
      auth,
      payloadSchema: parsedSchema,
      schemaInferredFrom: sample || undefined,
      schemaValidation,
      eventTypePath: preset.eventTypePath ?? undefined,
      deliveryIdHeader: preset.deliveryIdHeader ?? undefined,
    });
  }

  const needsSecret = preset.auth.mode !== "none";

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block text-slate-300 mb-1">Name</span>
          <input
            className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            placeholder={`Acme ${preset.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-300 mb-1">Description</span>
          <input
            className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            placeholder="(optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>

      <div className="rounded border border-slate-700 p-3 text-sm text-slate-300 space-y-2">
        <div className="font-medium text-slate-100">Auth: <code>{preset.auth.mode}</code></div>
        {needsSecret && (
          <SecretPicker
            authMode={preset.auth.mode}
            presetId={preset.id}
            scope={scope}
            orgId={orgId}
            isAdmin={isAdmin}
            value={secretRefInput}
            onChange={setSecretRefInput}
          />
        )}
      </div>

      <div className="rounded border border-slate-700 p-3 text-sm text-slate-300 space-y-2">
        <div className="font-medium text-slate-100">Payload schema</div>
        <label className="block">
          <span className="block text-slate-400 mb-1">Paste a sample payload (optional — generates a draft schema)</span>
          <textarea
            className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
            rows={5}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder='{ "action": "opened", "issue": { "number": 7 } }'
          />
          <button
            type="button"
            onClick={inferFromSample}
            className="mt-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
          >
            Generate schema from sample
          </button>
        </label>

        <label className="block">
          <span className="block text-slate-400 mb-1">Schema (JSON Schema draft-07)</span>
          <textarea
            className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
            rows={8}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder={"{}"}
          />
          {schemaError && <p className="text-xs text-danger mt-1">{schemaError}</p>}
        </label>

        <label className="block">
          <span className="block text-slate-400 mb-1">Validation mode</span>
          <select
            className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            value={schemaValidation}
            onChange={(e) => setSchemaValidation(e.target.value as ConfigFormValue["schemaValidation"])}
          >
            <option value="off">off — accept all payloads</option>
            <option value="warn">warn — tag invalid events</option>
            <option value="reject">reject — return 400 on schema mismatch</option>
          </select>
        </label>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-sm disabled:opacity-50"
      >
        {busy ? "Working…" : submitLabel}
      </button>
    </form>
  );
}

function refOf(auth: WebhookAuthConfig): string {
  switch (auth.mode) {
    case "none": return "";
    case "header-equals": return auth.valueRef;
    case "hmac": return auth.secretRef;
    case "jwt": return auth.signingKeyRef ?? "";
  }
}

function withRef(auth: WebhookAuthConfig, ref: string): WebhookAuthConfig {
  switch (auth.mode) {
    case "none": return auth;
    case "header-equals": return { ...auth, valueRef: ref };
    case "hmac": return { ...auth, secretRef: ref };
    case "jwt": return { ...auth, signingKeyRef: ref };
  }
}
