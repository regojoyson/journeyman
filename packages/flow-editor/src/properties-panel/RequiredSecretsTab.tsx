// packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx
import { useEffect, useState, useMemo } from "react";
import { PROVIDER_CATALOG } from "@journeyman/core";
import type { WorkflowGraph, WorkflowNode, SecretBinding, SecretScope } from "@journeyman/core";
import { fetchVisibleSecrets, type VisibleSecret } from "../api/secrets.ts";
import { useStepRegistry } from "../state/step-registry-context.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import type { SecretSlotDef } from "../step-definition.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";

export interface RequiredSecretsTabProps {
  flow: WorkflowGraph;
  node: WorkflowNode;
  orgId: string;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const SCOPE_LABEL: Record<SecretScope, string> = {
  user: "Your secrets",
  org: "Organization",
  global: "Global",
};
const SCOPE_ORDER: SecretScope[] = ["user", "org", "global"];

function getBinding(node: WorkflowNode, slotName: string): SecretBinding {
  return node.secretBindings?.[slotName] ?? { mode: "auto" };
}
function setBinding(node: WorkflowNode, slotName: string, binding: SecretBinding): WorkflowNode {
  return {
    ...node,
    secretBindings: { ...(node.secretBindings ?? {}), [slotName]: binding },
  };
}

function bindingKey(b: SecretBinding): string {
  return b.mode === "auto" ? "auto" : `pinned:${b.scope}:${b.name}`;
}
function parseBindingKey(key: string): SecretBinding | null {
  if (key === "auto") return { mode: "auto" };
  const m = /^pinned:(user|org|global):(.+)$/.exec(key);
  if (!m) return null;
  return { mode: "pinned", scope: m[1] as SecretScope, name: m[2] };
}

function autoResolveTier(
  slotName: string,
  visible: VisibleSecret[],
): SecretScope | null {
  for (const scope of SCOPE_ORDER) {
    if (visible.some(v => v.scope === scope && v.name === slotName)) return scope;
  }
  return null;
}

function pinnedExists(b: SecretBinding, visible: VisibleSecret[]): boolean {
  if (b.mode !== "pinned") return true;
  return visible.some(v => v.scope === b.scope && v.name === b.name);
}

function workflowScope(flow: WorkflowGraph): "user" | "org" | "global" | null {
  const fs = (flow as unknown as { scope?: "user" | "org" | "global" }).scope;
  return fs ?? null;
}

export function RequiredSecretsTab({ flow, node, orgId, onChange, readOnly }: RequiredSecretsTabProps) {
  const registry = useStepRegistry();
  const stepDef = node.stepType ? registry.get(node.stepType) : undefined;

  const kind = stepDef?.executor.kind;
  const effectiveProvider =
    node.executorConfig?.provider ??
    (kind && kind !== "control"
      ? flow.defaults?.executorConfig?.[kind]?.provider
      : undefined) ??
    (kind ? defaultProviderFor(kind) : undefined);
  const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];

  // Kind-override slots: when the step declares `slotsFromKind`, look up the
  // slot list from the workflow's catalog entry for that kind (e.g. the
  // git-provider). Lets a coding-cli step borrow credentials from a different
  // provider kind without hardcoding slot names.
  const slotsFromKind = stepDef?.slotsFromKind;
  const executorConfig = flow.defaults?.executorConfig as
    | Record<string, { provider?: string } | undefined>
    | undefined;
  const kindProvider = slotsFromKind ? executorConfig?.[slotsFromKind]?.provider : undefined;
  const kindOverrideSlots: SecretSlotDef[] = slotsFromKind && kindProvider
    ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProvider)?.slots ?? [])
    : [];

  // Custom-AI nodes carry their slots on the DB-backed step definition, not
  // the static registry entry. Fetch the def and prefer its slots when present.
  const customStepId =
    node.stepType === "custom-ai"
      ? ((node.config as { customStepId?: unknown } | undefined)?.customStepId as string | undefined)
      : undefined;
  const customStepIds = useMemo(() => (customStepId ? [customStepId] : []), [customStepId]);
  const customDefs = useCustomStepDefs(customStepIds);
  const customSlots: SecretSlotDef[] = customStepId ? (customDefs[customStepId]?.slots ?? []) : [];

  // For custom-ai nodes: union of
  //   - provider-level slots (e.g. ANTHROPIC_API_KEY for coding-cli/claude)
  //   - the static step-definition slots
  //   - the user-declared slots on the DB-backed custom step
  // Later sources win on name collisions, so a custom-step slot can override
  // a provider-level default if the step author wants different metadata.
  const slots: SecretSlotDef[] = (() => {
    if (node.stepType === "custom-ai") {
      const base = [...providerSlots, ...(stepDef?.slots ?? [])];
      const overrides = new Map(customSlots.map(s => [s.name, s]));
      const merged: SecretSlotDef[] = base.map(s => overrides.get(s.name) ?? s);
      for (const s of customSlots) {
        if (!base.some(b => b.name === s.name)) merged.push(s);
      }
      return merged;
    }
    if (kindOverrideSlots.length > 0) return kindOverrideSlots;
    return stepDef?.slots?.length ? stepDef.slots : providerSlots;
  })();

  const [visible, setVisible] = useState<VisibleSecret[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    // eslint-disable-next-line no-console
    console.log("[RequiredSecretsTab] fetching visible secrets", { orgId });
    fetchVisibleSecrets(orgId).then(r => {
      if (!cancelled) {
        // eslint-disable-next-line no-console
        console.log("[RequiredSecretsTab] secrets loaded", {
          orgId, count: r.scoped.length, ms: +(performance.now() - t0).toFixed(2),
        });
        setVisible(r.scoped); setLoaded(true);
      }
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error("[RequiredSecretsTab] fetchVisibleSecrets failed", err);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const grouped = useMemo(() => {
    const out: Record<SecretScope, string[]> = { user: [], org: [], global: [] };
    for (const v of visible) {
      if (!out[v.scope].includes(v.name)) out[v.scope].push(v.name);
    }
    for (const s of SCOPE_ORDER) out[s].sort();
    return out;
  }, [visible]);

  const fScope = workflowScope(flow);

  if (slots.length === 0) {
    if (slotsFromKind && !kindProvider) {
      return (
        <div className="je-props__field">
          <div style={{ color: "#f0c97a", fontSize: 11 }}>
            This step needs the workflow's <code>{slotsFromKind}</code> credentials.
            Pick a {slotsFromKind} in Workflow settings to see the required slot.
          </div>
        </div>
      );
    }
    return (
      <div className="je-props__field">
        <div style={{ color: "#888", fontSize: 11, fontStyle: "italic" }}>
          This step doesn't need any secrets.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="je-props__field" style={{ marginBottom: 12 }}>
        <button
          onClick={() => setHelpOpen(o => !o)}
          style={{
            background: "transparent", border: "1px solid #2a3148", color: "#7da7ff",
            padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
          }}
        >{helpOpen ? "▾" : "▸"} How secrets are resolved</button>
        {helpOpen && (
          <div style={{
            marginTop: 6, padding: "8px 10px", background: "#161a26",
            border: "1px solid #2a3148", borderRadius: 4, fontSize: 11, color: "#bbb",
            lineHeight: 1.5,
          }}>
            Each row below is something this step needs at run time.<br />
            <b style={{ color: "#7da7ff" }}>Auto</b> — system finds a secret with the
            exact same name. Looks in <i>your secrets first</i>, then <i>organization</i>,
            then <i>global</i>. First match wins.<br />
            <b style={{ color: "#7da7ff" }}>Pin</b> — pick one specific secret from any
            tier. That exact one is used; no fallback.<br />
            Names are exact and case-sensitive. <code>GITHUB_TOKEN</code> won't match
            <code>MY_GITHUB_TOKEN</code>.
          </div>
        )}
      </div>

      {slots.map(slot => {
        const binding = node.secretBindings?.[slot.name] ?? { mode: "auto" as const };
        return (
          <SlotRow
            key={slot.name}
            slot={slot}
            binding={binding}
            visible={visible}
            grouped={grouped}
            loaded={loaded}
            workflowScope={fScope}
            readOnly={readOnly}
            onChange={(next) => onChange(setBinding(node, slot.name, next))}
          />
        );
      })}
    </div>
  );
}

interface SlotRowProps {
  slot: SecretSlotDef;
  binding: SecretBinding;
  visible: VisibleSecret[];
  grouped: Record<SecretScope, string[]>;
  loaded: boolean;
  workflowScope: "user" | "org" | "global" | null;
  readOnly?: boolean;
  onChange: (next: SecretBinding) => void;
}

function SlotRow({ slot, binding, visible, grouped, loaded, workflowScope, readOnly, onChange }: SlotRowProps) {
  const autoTier = useMemo(() => autoResolveTier(slot.name, visible), [slot.name, visible]);
  const exists = pinnedExists(binding, visible);

  const onSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = parseBindingKey(e.target.value);
    if (next) onChange(next);
  };

  const crossScope =
    binding.mode === "pinned" &&
    workflowScope !== null &&
    isNarrower(binding.scope, workflowScope);

  return (
    <div className="je-props__field" style={{
      borderTop: "1px solid #2a2a3a", paddingTop: 10, marginTop: 10,
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#ddd" }}>
          {slot.name}
        </code>
        {slot.optional && (
          <span style={{ fontSize: 10, color: "#888" }}>(optional)</span>
        )}
      </label>
      <div style={{ fontSize: 10, color: "#888", marginTop: 2, marginBottom: 6 }}>
        {slot.description}
      </div>

      <select
        value={bindingKey(binding)}
        onChange={onSelect}
        disabled={readOnly}
        style={{
          width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11,
          background: "#1f1f2c", border: "1px solid #444", color: "#ddd",
          padding: "4px 6px", borderRadius: 4,
        }}
      >
        <option value="auto">Auto (Your secrets &gt; Organization &gt; Global)</option>
        {SCOPE_ORDER.map(scope => {
          const names = grouped[scope];
          if (names.length === 0) return null;
          return (
            <optgroup key={scope} label={SCOPE_LABEL[scope]}>
              {names.map(n => (
                <option key={`${scope}:${n}`} value={`pinned:${scope}:${n}`}>{n}</option>
              ))}
            </optgroup>
          );
        })}
      </select>

      <Preview
        slot={slot}
        binding={binding}
        autoTier={autoTier}
        exists={exists}
        loaded={loaded}
      />

      {crossScope && (
        <div style={{
          marginTop: 6, fontSize: 11, color: "#f0c97a",
          padding: "4px 8px", background: "#3a2e1a",
          border: "1px solid #c08a3e", borderRadius: 4,
        }}>
          ⚠ This is a {workflowScope}-scope flow but you pinned a {(binding as { scope: SecretScope }).scope}-scope secret.
          Other runners won't see it.
        </div>
      )}
    </div>
  );
}

function isNarrower(pinned: SecretScope, flow: "user" | "org" | "global"): boolean {
  if (flow === "user") return false;
  if (flow === "org") return pinned === "user";
  /* global */ return pinned === "user" || pinned === "org";
}

interface PreviewProps {
  slot: SecretSlotDef;
  binding: SecretBinding;
  autoTier: SecretScope | null;
  exists: boolean;
  loaded: boolean;
}

function Preview({ slot, binding, autoTier, exists, loaded }: PreviewProps) {
  if (!loaded) return null;
  const style = (color: string) => ({
    marginTop: 4, fontSize: 11, color,
  });
  if (binding.mode === "auto") {
    if (autoTier) {
      return <div style={style("#7fc480")}>✓ Will use: {slot.name} from {SCOPE_LABEL[autoTier]}</div>;
    }
    if (slot.optional) {
      return <div style={style("#9aaab9")}>ℹ Optional. None found — step will use its own default.</div>;
    }
    return <div style={style("#f0c97a")}>⚠ No secret named {slot.name} in any tier. Run will fail.</div>;
  }
  if (!exists) {
    return <div style={style("#f0c97a")}>⚠ Pinned secret {binding.name} ({SCOPE_LABEL[binding.scope]}) is not accessible. Runs will fail.</div>;
  }
  return <div style={style("#9aaab9")}>ℹ Pinned to {binding.name} ({SCOPE_LABEL[binding.scope]}). No fallback.</div>;
}
