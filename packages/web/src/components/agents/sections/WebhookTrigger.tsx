import type { AgentInputField } from "@journeyman/core";
import { useWorkspaceWebhooks } from "../../../lib/useWorkspaceWebhooks.ts";
import { ListensForPicker } from "../../../lib/ListensForPicker.tsx";
import { AcceptIfBuilder } from "../../../lib/AcceptIfBuilder.tsx";
import { pathsFromSchema } from "../../../lib/pathsFromSchema.ts";
import { inputCls } from "../../../routes/admin-styles.ts";

interface WebhookTriggerProps {
  wsId: string;
  webhookId: string;
  listensFor: string[];
  filters: unknown | undefined;
  inputsMapping: Record<string, string>;
  inputs: AgentInputField[];
  locked: boolean;
  onChange: (patch: {
    webhookId: string;
    listensFor: string[];
    filters: unknown | undefined;
    inputsMapping: Record<string, string>;
  }) => void;
}

export function WebhookTrigger({
  wsId,
  webhookId,
  listensFor,
  filters,
  inputsMapping,
  inputs,
  locked,
  onChange,
}: WebhookTriggerProps) {
  const { webhooks, loading } = useWorkspaceWebhooks(wsId);
  const picked = webhooks.find((w) => w.id === webhookId);
  const knownEventTypes = picked?.knownEventTypes ?? [];
  const knownPaths = pathsFromSchema(picked?.payloadSchema);
  const datalistId = `wh-paths-${webhookId || "none"}`;

  const emit = (partial: Partial<Parameters<typeof onChange>[0]>) =>
    onChange({ webhookId, listensFor, filters, inputsMapping, ...partial });

  return (
    <div className="space-y-4">
      {/* Webhook selector */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Webhook</div>
        {loading ? (
          <div className="text-xs text-muted-foreground italic">Loading webhooks…</div>
        ) : webhooks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No webhooks in this workspace yet.{" "}
            <a href="/webhooks" className="underline hover:text-foreground">
              Create one
            </a>{" "}
            to use it as a trigger.
          </p>
        ) : (
          <select
            className={inputCls}
            disabled={locked}
            value={webhookId}
            onChange={(e) => emit({ webhookId: e.target.value, listensFor: [], filters: undefined })}
          >
            <option value="">— pick a webhook —</option>
            {webhooks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.preset})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Event-type filter */}
      {webhookId && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            Listen for
            <span className="ml-1.5 text-muted-foreground font-normal normal-case tracking-normal">
              — leave empty to accept any event type
            </span>
          </div>
          <ListensForPicker
            value={listensFor}
            knownEventTypes={knownEventTypes}
            webhookPicked={Boolean(webhookId)}
            readOnly={locked}
            onChange={(next) => emit({ listensFor: next })}
          />
        </div>
      )}

      {/* Payload filter (AcceptIf) */}
      {webhookId && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            Accept if
            <span className="ml-1.5 text-muted-foreground font-normal normal-case tracking-normal">
              — optional payload filter
            </span>
          </div>
          {knownPaths.length > 0 && (
            <datalist id={datalistId}>
              {knownPaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
          <AcceptIfBuilder
            value={filters}
            knownPaths={knownPaths}
            readOnly={locked}
            datalistId={datalistId}
            onChange={(next) => emit({ filters: next })}
          />
        </div>
      )}

      {/* Inputs mapping */}
      {webhookId && inputs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Map inputs from payload</div>
          <p className="text-xs text-muted-foreground">
            Map each agent input to a JSON path in the webhook payload (e.g.{" "}
            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">$.issue.key</code>).
            {knownPaths.length > 0 && " Suggestions appear as you type."}
          </p>
          {inputs.map((inp) => (
            <div key={inp.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate text-foreground" title={inp.name}>
                {inp.name}
              </span>
              <span className="text-muted-foreground">←</span>
              <input
                className={inputCls}
                disabled={locked}
                placeholder="$.path.to.field"
                list={knownPaths.length > 0 ? datalistId : undefined}
                value={inputsMapping[inp.name] ?? ""}
                onChange={(e) => {
                  const next = { ...inputsMapping, [inp.name]: e.target.value };
                  if (!e.target.value) delete next[inp.name];
                  emit({ inputsMapping: next });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {webhookId && inputs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">{"{{inputs}}"}</code> to your
          prompt to map payload fields to agent inputs.
        </p>
      )}
    </div>
  );
}
