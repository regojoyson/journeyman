# Webhook Test Payload — Sample & Schema Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two buttons to the webhook Test panel — "Load sample" and "Generate from schema" — that pre-fill the editable payload textarea so users can start from a realistic JSON and tweak it.

**Architecture:** Pure frontend change. The backend (`GET /api/webhook-presets/:id`) already returns both `samples` and `payloadSchema`, and the web client type `WebhookPresetDetail` already includes both fields. Add a small synchronous JSON-Schema → skeleton generator and wire two buttons into the existing test panel.

**Tech Stack:** React, TypeScript, no new dependencies.

**Out of scope (per user):** unit tests, git commits. End with a typecheck.

**Spec:** [docs/superpowers/specs/2026-05-25-webhook-test-payload-from-schema-design.md](../specs/2026-05-25-webhook-test-payload-from-schema-design.md)

---

## File Structure

- **Create:** `packages/web/src/routes/webhooks/schema-skeleton.ts` — pure `skeletonFromSchema(schema): unknown` function.
- **Modify:** `packages/web/src/routes/webhooks/WebhookTestPanel.tsx` — load `payloadSchema` from preset detail, render two buttons, wire them to fill `customPayload`.

No backend or API-client changes — `WebhookPresetDetail.payloadSchema` already exists ([packages/web/src/api/webhooks.ts:25-28](../../../packages/web/src/api/webhooks.ts)).

---

### Task 1: Schema-skeleton generator

**Files:**
- Create: `packages/web/src/routes/webhooks/schema-skeleton.ts`

- [ ] **Step 1: Create `schema-skeleton.ts` with the full generator**

Write this exact file:

```typescript
// Synthesizes a JSON skeleton from a draft-07 JSON Schema subset used by
// webhook presets. Pure, synchronous, no external deps.
//
// Supported: type=object/array/string/integer/number/boolean/null,
// default/example/enum hints, oneOf/anyOf/allOf (first variant).
// Unsupported constructs ($ref, conditional schemas) collapse to null.

type Schema = Record<string, unknown>;

function isObject(v: unknown): v is Schema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstVariant(schema: Schema): Schema | null {
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const arr = schema[key];
    if (Array.isArray(arr) && arr.length > 0 && isObject(arr[0])) {
      return arr[0] as Schema;
    }
  }
  return null;
}

function stringValue(schema: Schema): string {
  if (typeof schema.default === "string") return schema.default;
  if (typeof schema.example === "string") return schema.example;
  if (Array.isArray(schema.enum) && typeof schema.enum[0] === "string") {
    return schema.enum[0];
  }
  return "";
}

function numberValue(schema: Schema): number {
  if (typeof schema.default === "number") return schema.default;
  if (typeof schema.example === "number") return schema.example;
  return 0;
}

function booleanValue(schema: Schema): boolean {
  if (typeof schema.default === "boolean") return schema.default;
  if (typeof schema.example === "boolean") return schema.example;
  return false;
}

export function skeletonFromSchema(schema: unknown): unknown {
  if (!isObject(schema)) return null;

  const variant = firstVariant(schema);
  if (variant) return skeletonFromSchema(variant);

  const type = schema.type;
  if (type === "object" || (type === undefined && isObject(schema.properties))) {
    const props = isObject(schema.properties) ? schema.properties : {};
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(props)) {
      out[key] = skeletonFromSchema(sub);
    }
    return out;
  }
  if (type === "array") {
    const items = schema.items;
    if (isObject(items)) return [skeletonFromSchema(items)];
    return [];
  }
  if (type === "string") return stringValue(schema);
  if (type === "integer" || type === "number") return numberValue(schema);
  if (type === "boolean") return booleanValue(schema);
  if (type === "null") return null;
  return null;
}
```

---

### Task 2: Wire the test panel — load schema, add buttons

**Files:**
- Modify: `packages/web/src/routes/webhooks/WebhookTestPanel.tsx`

- [ ] **Step 1: Replace the contents of `WebhookTestPanel.tsx`**

Write the file with this exact content (full replacement — diff is small but rewriting end-to-end avoids ambiguity):

```typescript
import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";
import { getPresetDetail, testWebhook, type TestDeliveryResult } from "../../api/webhooks.ts";
import { skeletonFromSchema } from "./schema-skeleton.ts";

export function WebhookTestPanel({ webhook }: { webhook: Webhook }) {
  const [samples, setSamples] = useState<Record<string, unknown>>({});
  const [schema, setSchema] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>("");
  const [customPayload, setCustomPayload] = useState<string>("");
  const [result, setResult] = useState<TestDeliveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPresetDetail(webhook.preset)
      .then((d) => {
        const s = (d.samples ?? {}) as Record<string, unknown>;
        setSamples(s);
        setSchema(d.payloadSchema ?? null);
        const keys = Object.keys(s);
        if (keys.length > 0) setSelected(keys[0]!);
      })
      .catch(() => { /* preset may not exist (generic); leave empty */ });
  }, [webhook.preset]);

  function loadSampleIntoTextarea() {
    if (!selected) return;
    const sample = samples[selected];
    if (sample === undefined) return;
    setCustomPayload(JSON.stringify(sample, null, 2));
  }

  function loadSchemaSkeletonIntoTextarea() {
    if (!schema) return;
    const skeleton = skeletonFromSchema(schema);
    setCustomPayload(JSON.stringify(skeleton, null, 2));
  }

  async function send() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      let body: { sampleEvent?: string; payload?: unknown };
      if (customPayload.trim()) {
        try { body = { payload: JSON.parse(customPayload) }; }
        catch (e) { throw new Error(`Custom payload not JSON: ${e instanceof Error ? e.message : String(e)}`); }
      } else if (selected) {
        body = { sampleEvent: selected };
      } else {
        throw new Error("Pick a sample or paste a custom payload");
      }
      setResult(await testWebhook(webhook.id, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sampleKeys = Object.keys(samples);
  const hasSchema = schema != null;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-400">
        Sends a synthetic, validly-signed event through this webhook's ingest pipeline. JWT auth is not synthesized in v1.
      </p>
      {sampleKeys.length > 0 && (
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Sample event from preset</span>
          <select
            className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sampleKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        {sampleKeys.length > 0 && (
          <button
            type="button"
            onClick={loadSampleIntoTextarea}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs"
          >
            Load sample
          </button>
        )}
        {hasSchema && (
          <button
            type="button"
            onClick={loadSchemaSkeletonIntoTextarea}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs"
          >
            Generate from schema
          </button>
        )}
      </div>
      <label className="block">
        <span className="block text-xs text-slate-400 mb-1">Or paste a custom payload (overrides sample)</span>
        <textarea
          rows={6}
          className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          value={customPayload}
          onChange={(e) => setCustomPayload(e.target.value)}
          placeholder='{"action":"opened"}'
        />
      </label>
      <button
        onClick={send}
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send test event"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <pre className="text-xs rounded bg-slate-900 border border-slate-700 p-2 overflow-x-auto">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

What changed vs. the existing file:
- Imports `skeletonFromSchema` from `./schema-skeleton.ts`.
- Adds `schema` state, populated from `d.payloadSchema` in the existing `useEffect`.
- Adds `loadSampleIntoTextarea()` and `loadSchemaSkeletonIntoTextarea()` handlers.
- Adds a new button row (the two buttons) directly above the textarea, each conditionally rendered.
- All existing behavior (dropdown, textarea, send semantics) preserved.

---

### Task 3: Typecheck

**Files:** none

- [ ] **Step 1: Run repo-wide typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

If the typecheck reports errors in `WebhookTestPanel.tsx` or `schema-skeleton.ts`, fix them in place and re-run. Do not touch unrelated errors that pre-existed on the branch.

---

## Self-Review

- **Spec coverage:**
  - Load sample button → Task 2 (`loadSampleIntoTextarea`). ✓
  - Generate from schema button → Task 2 (`loadSchemaSkeletonIntoTextarea`) + Task 1 (generator). ✓
  - Hide "Load sample" when no samples → Task 2 (`sampleKeys.length > 0` guard on button). ✓
  - Hide "Generate from schema" when no schema → Task 2 (`hasSchema` guard). ✓
  - Schema → skeleton table from spec (object/array/string/number/boolean/null/oneOf/anyOf/allOf, default/example/enum hints) → Task 1. ✓
  - Send semantics unchanged → Task 2 (`send()` body untouched). ✓
  - Backend `schema` exposure → already implemented, no task needed (noted in header). ✓
- **Placeholder scan:** none.
- **Type consistency:** `skeletonFromSchema` signature matches between Task 1 definition and Task 2 import. State types (`unknown`, `Record<string, unknown>`) match `WebhookPresetDetail` fields.
- **Scope adherence (user override):** no unit tests, no commits — only typecheck at the end. ✓
