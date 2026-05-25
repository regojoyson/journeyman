import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { createMyWebhook, createOrgWebhook, getPresetDetail } from "../../api/webhooks.ts";
import { useAuth } from "../../AuthContext.tsx";
import { WebhookConfigForm, type ConfigFormValue } from "./WebhookConfigForm.tsx";
import { WebhookPresetGallery } from "./WebhookPresetGallery.tsx";
import { WebhookSecretReveal } from "./WebhookSecretReveal.tsx";

interface Props {
  scope: { orgId: string } | { userId: "me" };
  onCreated: (w: Webhook) => void;
  onCancel: () => void;
}

export function WebhookCreateWizard({ scope, onCreated, onCancel }: Props) {
  const { activeOrgId, role } = useAuth();
  const [step, setStep] = useState<"pick" | "configure" | "reveal">("pick");
  const [preset, setPreset] = useState<WebhookPresetSummary | null>(null);
  const [presetSchema, setPresetSchema] = useState<unknown>(undefined);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [created, setCreated] = useState<Webhook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickPreset(p: WebhookPresetSummary) {
    setPreset(p);
    setPresetSchema(undefined);
    setStep("configure");
    if (p.hasSchema) {
      setLoadingSchema(true);
      try {
        const detail = await getPresetDetail(p.id);
        setPresetSchema(detail.payloadSchema);
      } catch {
        // Schema fetch failed — non-fatal; user can paste a sample or type one.
      } finally {
        setLoadingSchema(false);
      }
    }
  }

  async function submit(v: ConfigFormValue) {
    if (!preset) return;
    setBusy(true);
    setError(null);
    try {
      const args = {
        name: v.name,
        description: v.description || undefined,
        preset: preset.id,
        kind: preset.kind,
        auth: v.auth,
        payloadSchema: v.payloadSchema,
        schemaInferredFrom: v.schemaInferredFrom,
        schemaValidation: v.schemaValidation,
        eventTypePath: v.eventTypePath,
        deliveryIdHeader: v.deliveryIdHeader,
        correlationSuggestions: v.correlationSuggestions,
      };
      const w = "orgId" in scope
        ? await createOrgWebhook(scope.orgId, args)
        : await createMyWebhook(args);
      setCreated(w);
      setStep("reveal");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "pick") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">Choose a preset</h2>
          <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-100">Cancel</button>
        </div>
        <WebhookPresetGallery onPick={pickPreset} />
      </div>
    );
  }

  if (step === "configure" && preset) {
    // Render the form only after the schema fetch resolves (or finishes failing).
    // Otherwise the form's useState would capture an empty initial value before
    // the schema arrives. Re-keying on preset.id + schema-loaded ensures the
    // textarea state initializes from the bundled schema.
    const formKey = `${preset.id}:${loadingSchema ? "loading" : "ready"}`;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">Configure {preset.name}</h2>
          <button onClick={() => setStep("pick")} className="text-sm text-slate-400 hover:text-slate-100">← back</button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loadingSchema ? (
          <p className="text-sm text-slate-400">Loading preset schema…</p>
        ) : (
          <WebhookConfigForm
            key={formKey}
            preset={preset}
            initial={{ payloadSchema: presetSchema }}
            onSubmit={submit}
            busy={busy}
            scope={"orgId" in scope ? "org" : "user"}
            orgId={"orgId" in scope ? scope.orgId : activeOrgId}
            isAdmin={role === "admin"}
          />
        )}
      </div>
    );
  }

  if (step === "reveal" && created) {
    return (
      <WebhookSecretReveal
        webhook={created}
        onDone={() => onCreated(created)}
      />
    );
  }

  return null;
}
