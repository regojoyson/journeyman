# Webhook Management — Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@journeyman/webhooks` package — the pure library layer of the webhook management feature. Auth verifiers, schema infer/validate, path extractors, preset loader, and 11 preset bundles. No DB, no HTTP, no UI.

**Architecture:** New backend-layer workspace package `packages/webhooks`. Types extend the existing `@journeyman/core/src/types/webhook.types.ts`. Auth modes implemented as small focused modules with a dispatching `verify()` entry. Preset bundles are JSON files in `packages/webhooks/presets/<id>/` loaded at startup and cached in-process. JSON Schema validation via `ajv`; JWT verification via `jose`.

**Tech Stack:** TypeScript (NodeNext ESM), Node.js `node:crypto`, `ajv` (JSON Schema), `jose` (JWT + JWKS).

**Spec:** [`docs/superpowers/specs/2026-05-25-webhook-management-design.md`](../specs/2026-05-25-webhook-management-design.md)

**Project constraints (overrides skill defaults):**

- **No commits.** Do not run `git commit` at any step. The user will commit when ready.
- **No unit tests.** Skip "write failing test" / "run test" steps. Test files are not part of this plan.
- **Verification at end only.** Final task runs `npm run check` (typecheck + import boundaries). That is the gate.

---

## File Structure

```
packages/webhooks/
├── package.json
├── tsconfig.json
├── presets/
│   ├── github/{preset.json,schema.json,samples/{push.json,pull_request.json}}
│   ├── github-issues/{preset.json,schema.json,samples/issues.json}
│   ├── github-projects/{preset.json,schema.json,samples/projects_v2_item.json}
│   ├── gitlab/{preset.json,schema.json,samples/push.json}
│   ├── gitlab-issues/{preset.json,schema.json,samples/issue.json}
│   ├── bitbucket/{preset.json,schema.json,samples/pullrequest_created.json}
│   ├── bitbucket-issues/{preset.json,schema.json,samples/issue_created.json}
│   ├── jira/{preset.json,schema.json,samples/issue_updated.json}
│   ├── linear/{preset.json,schema.json,samples/issue_create.json}
│   ├── monday/{preset.json,schema.json,samples/create_pulse.json}
│   └── generic/preset.json
└── src/
    ├── index.ts                    ← public exports
    ├── auth/
    │   ├── verify.ts               ← dispatch on auth.mode
    │   ├── timing-safe.ts          ← constant-time compare helpers
    │   ├── none.ts
    │   ├── header-equals.ts
    │   ├── hmac.ts                 ← hmac + optional timestamp
    │   └── jwt.ts                  ← HS256 / RS256 via jose
    ├── schema/
    │   ├── lint.ts                 ← validate a JSON Schema document
    │   ├── validate.ts             ← validate payload against schema
    │   └── infer.ts                ← infer schema from sample payload
    ├── extract/
    │   ├── path.ts                 ← dot-path / "$.foo.bar" walker
    │   └── event-type.ts           ← "header:x-..." | "$.path"
    └── presets/
        ├── loader.ts               ← read presets/* on disk, validate, cache
        └── types.ts                ← Preset, PresetId
```

The `@journeyman/core` types file (`packages/core/src/types/webhook.types.ts`) is extended with shared types — `WebhookAuthConfig`, `Webhook`, the expanded `WebhookProvider`/`PresetId` union, etc.

---

### Task 1: Scaffold the package

**Files:**
- Create: `packages/webhooks/package.json`
- Create: `packages/webhooks/tsconfig.json`
- Create: `packages/webhooks/src/index.ts`

- [ ] **Step 1: Create `packages/webhooks/package.json`**

```json
{
  "name": "@journeyman/webhooks",
  "version": "0.1.0",
  "description": "Webhook auth, schema, and preset library for Journeyman",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./presets/*": "./presets/*"
  },
  "files": ["src", "presets"],
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "jose": "^5.9.6"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Create `packages/webhooks/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create empty `packages/webhooks/src/index.ts`**

```ts
// Public surface filled in by later tasks.
export {};
```

- [ ] **Step 4: Install workspace dependencies**

Run: `npm install`
Expected: lockfile updates, `node_modules/@journeyman/webhooks` symlinked.

---

### Task 2: Register the package in import-boundary script

**Files:**
- Modify: `scripts/check-import-boundaries.mjs` (the `PKG_LAYER` map)

- [ ] **Step 1: Add the new package to `PKG_LAYER`**

In `scripts/check-import-boundaries.mjs`, add this entry to the `PKG_LAYER` object alongside the other backend packages (after `@journeyman/migrations`):

```js
  "@journeyman/webhooks": "backend",
```

The package contains `node:crypto` and `node:fs` usage (for preset loading), so it must be `backend`. UI code that needs preset metadata will fetch it via the future API route, not by direct import.

---

### Task 3: Extend `@journeyman/core` types

**Files:**
- Modify: `packages/core/src/types/webhook.types.ts`
- Modify: `packages/core/src/index.ts` (add exports)

- [ ] **Step 1: Replace `packages/core/src/types/webhook.types.ts`** with the expanded type set

```ts
export type WebhookEventStatus = "received" | "processed" | "ignored" | "error" | "auth_failed" | "schema_invalid";

// Legacy provider union retained for backward compatibility with existing
// /webhooks/:provider routes and stored events.
export type WebhookProvider = "jira" | "github" | "monday" | "linear" | "api" | "manual";

export type PresetId =
  | "github"
  | "github-issues"
  | "github-projects"
  | "gitlab"
  | "gitlab-issues"
  | "bitbucket"
  | "bitbucket-issues"
  | "jira"
  | "linear"
  | "monday"
  | "generic";

export type WebhookKind = "ticket" | "git";

export type WebhookAuthConfig =
  | { mode: "none" }
  | { mode: "header-equals"; header: string; valueRef: string }
  | {
      mode: "hmac";
      algo: "sha256" | "sha1" | "sha512";
      encoding: "hex" | "base64";
      header: string;
      prefix?: string;
      secretRef: string;
      timestamp?: {
        header: string;
        toleranceSeconds: number;
        signedFormat: string; // e.g. "{timestamp}.{body}"
      };
    }
  | {
      mode: "jwt";
      algo: "HS256" | "RS256" | "ES256";
      header: string;
      stripPrefix?: string;
      signingKeyRef?: string;
      jwksUrl?: string;
      expectedIssuer?: string;
      expectedAudience?: string;
    };

export type WebhookCorrelationSuggestion = {
  key: string;
  path: string;
};

export type WebhookScope = { orgId: string } | { userId: string };

export type Webhook = {
  id: string;
  scope: WebhookScope;
  name: string;
  description?: string;
  preset: PresetId;
  kind: WebhookKind;

  tenantToken: string;
  ingestUrl: string;

  auth: WebhookAuthConfig;

  payloadSchema?: unknown; // JSON Schema document; opaque to consumers
  schemaValidation: "off" | "warn" | "reject";
  schemaInferredFrom?: string;

  eventTypePath?: string;     // "header:x-github-event" | "$.webhookEvent"
  deliveryIdHeader?: string;

  correlationSuggestions?: WebhookCorrelationSuggestion[];

  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
  lastEventAt?: Date;
};

export type WebhookEvent = {
  id: string;
  receivedAt: Date;
  webhookId: string | null;
  provider: WebhookProvider;
  eventType: string | null;
  deliveryId: string | null;
  issueRef: string | null;
  productId: string | null;
  rawHeaders: Record<string, string>;
  rawPayload: unknown;
  status: WebhookEventStatus;
  error: string | null;
};

export type CreateWebhookEventArgs = Omit<WebhookEvent, "id" | "receivedAt" | "status" | "error">;
```

- [ ] **Step 2: Verify `packages/core/src/index.ts` re-exports the file**

Open `packages/core/src/index.ts`. If it already has a line like `export * from "./types/webhook.types.ts";`, no change needed. Otherwise add one alongside the other type re-exports.

---

### Task 4: Timing-safe compare helper

**Files:**
- Create: `packages/webhooks/src/auth/timing-safe.ts`

- [ ] **Step 1: Write the helper**

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two strings interpreted as UTF-8.
 * Returns false (without throwing) when lengths differ.
 */
export function constantTimeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Constant-time comparison of two hex- or base64-encoded digests.
 * The two inputs may use different encodings as long as they decode to the
 * same byte length.
 */
export function constantTimeEqualEncoded(
  a: string,
  b: string,
  encoding: "hex" | "base64",
): boolean {
  const ab = Buffer.from(a, encoding);
  const bb = Buffer.from(b, encoding);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

---

### Task 5: Auth verifier — `none` and `header-equals`

**Files:**
- Create: `packages/webhooks/src/auth/none.ts`
- Create: `packages/webhooks/src/auth/header-equals.ts`

- [ ] **Step 1: Create `none.ts`**

```ts
import type { VerifyInput, VerifyResult } from "./verify.ts";

export function verifyNone(_input: VerifyInput): VerifyResult {
  return { ok: true };
}
```

- [ ] **Step 2: Create `header-equals.ts`**

```ts
import type { WebhookAuthConfig } from "@journeyman/core";
import { constantTimeEqualString } from "./timing-safe.ts";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type HeaderEqualsConfig = Extract<WebhookAuthConfig, { mode: "header-equals" }>;

export function verifyHeaderEquals(
  input: VerifyInput,
  cfg: HeaderEqualsConfig,
  resolvedSecret: string,
): VerifyResult {
  const headerKey = cfg.header.toLowerCase();
  const presented = input.headers[headerKey];
  if (!presented) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }
  if (!constantTimeEqualString(presented, resolvedSecret)) {
    return { ok: false, reason: "header value mismatch" };
  }
  return { ok: true };
}
```

---

### Task 6: Auth verifier — HMAC (with optional timestamp)

**Files:**
- Create: `packages/webhooks/src/auth/hmac.ts`

- [ ] **Step 1: Write the HMAC verifier**

```ts
import { createHmac } from "node:crypto";
import type { WebhookAuthConfig } from "@journeyman/core";
import { constantTimeEqualEncoded } from "./timing-safe.ts";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type HmacConfig = Extract<WebhookAuthConfig, { mode: "hmac" }>;

export function verifyHmac(
  input: VerifyInput,
  cfg: HmacConfig,
  resolvedSecret: string,
): VerifyResult {
  const headerKey = cfg.header.toLowerCase();
  const presented = input.headers[headerKey];
  if (!presented) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }

  // Strip provider prefix if configured (e.g. "sha256=").
  let candidate = presented;
  if (cfg.prefix && candidate.startsWith(cfg.prefix)) {
    candidate = candidate.slice(cfg.prefix.length);
  }

  // Build the signed string.
  let signed: string;
  if (cfg.timestamp) {
    const tsKey = cfg.timestamp.header.toLowerCase();
    const ts = input.headers[tsKey];
    if (!ts) {
      return { ok: false, reason: `missing timestamp header ${cfg.timestamp.header}` };
    }
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) {
      return { ok: false, reason: "timestamp not numeric" };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > cfg.timestamp.toleranceSeconds) {
      return { ok: false, reason: "timestamp outside tolerance" };
    }
    signed = cfg.timestamp.signedFormat
      .replace("{timestamp}", ts)
      .replace("{body}", input.rawBody.toString("utf8"));
  } else {
    signed = input.rawBody.toString("utf8");
  }

  const computed = createHmac(cfg.algo, resolvedSecret)
    .update(signed, "utf8")
    .digest(cfg.encoding);

  if (!constantTimeEqualEncoded(candidate, computed, cfg.encoding)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
```

---

### Task 7: Auth verifier — JWT (HS256 + RS256 via JWKS)

**Files:**
- Create: `packages/webhooks/src/auth/jwt.ts`

- [ ] **Step 1: Write the JWT verifier**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions, type KeyLike } from "jose";
import type { WebhookAuthConfig } from "@journeyman/core";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type JwtConfig = Extract<WebhookAuthConfig, { mode: "jwt" }>;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  let entry = jwksCache.get(url);
  if (!entry) {
    entry = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 60 * 60 * 1000,         // 1h
      cooldownDuration: 30 * 1000,         // 30s between refetches on key miss
    });
    jwksCache.set(url, entry);
  }
  return entry;
}

export async function verifyJwt(
  input: VerifyInput,
  cfg: JwtConfig,
  resolvedSigningKey: string | null,
): Promise<VerifyResult> {
  const headerKey = cfg.header.toLowerCase();
  let token = input.headers[headerKey];
  if (!token) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }
  if (cfg.stripPrefix && token.startsWith(cfg.stripPrefix)) {
    token = token.slice(cfg.stripPrefix.length);
  }

  const options: JWTVerifyOptions = { algorithms: [cfg.algo] };
  if (cfg.expectedIssuer) options.issuer = cfg.expectedIssuer;
  if (cfg.expectedAudience) options.audience = cfg.expectedAudience;

  try {
    if (cfg.algo === "HS256") {
      if (!resolvedSigningKey) {
        return { ok: false, reason: "HS256 requires signingKeyRef" };
      }
      const keyBytes = new TextEncoder().encode(resolvedSigningKey);
      await jwtVerify(token, keyBytes, options);
    } else {
      if (!cfg.jwksUrl) {
        return { ok: false, reason: `${cfg.algo} requires jwksUrl` };
      }
      const jwks = getJwks(cfg.jwksUrl) as unknown as KeyLike;
      await jwtVerify(token, jwks, options);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "jwt verify failed" };
  }
}
```

---

### Task 8: Auth dispatcher

**Files:**
- Create: `packages/webhooks/src/auth/verify.ts`

- [ ] **Step 1: Write the dispatcher**

```ts
import type { WebhookAuthConfig } from "@journeyman/core";
import { verifyNone } from "./none.ts";
import { verifyHeaderEquals } from "./header-equals.ts";
import { verifyHmac } from "./hmac.ts";
import { verifyJwt } from "./jwt.ts";

export type VerifyInput = {
  /** Lowercased header names → values. Multi-value headers joined with ", ". */
  headers: Record<string, string>;
  /** Raw request body, unparsed, for signature reconstruction. */
  rawBody: Buffer;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify an inbound webhook request per its auth config. The caller must
 * resolve any secret/key reference and pass the plaintext as `resolvedSecret`.
 * For `none`, pass `null`.
 */
export async function verifyWebhookRequest(
  input: VerifyInput,
  auth: WebhookAuthConfig,
  resolvedSecret: string | null,
): Promise<VerifyResult> {
  switch (auth.mode) {
    case "none":
      return verifyNone(input);
    case "header-equals":
      if (!resolvedSecret) return { ok: false, reason: "missing secret" };
      return verifyHeaderEquals(input, auth, resolvedSecret);
    case "hmac":
      if (!resolvedSecret) return { ok: false, reason: "missing secret" };
      return verifyHmac(input, auth, resolvedSecret);
    case "jwt":
      // resolvedSecret may be null for asymmetric (RS256/ES256) — verifier handles it.
      return verifyJwt(input, auth, resolvedSecret);
  }
}
```

---

### Task 9: Schema lint (validate a JSON Schema document)

**Files:**
- Create: `packages/webhooks/src/schema/lint.ts`

- [ ] **Step 1: Write the lint helper**

```ts
import Ajv from "ajv";
import addFormats from "ajv-formats";

let cached: Ajv | null = null;

function getAjv(): Ajv {
  if (!cached) {
    cached = new Ajv({ allErrors: true, strict: false });
    addFormats(cached);
  }
  return cached;
}

export type LintResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Confirms the given document is itself a valid JSON Schema by compiling it.
 * Catches malformed `type`, unresolved `$ref`, etc.
 */
export function lintJsonSchema(schema: unknown): LintResult {
  try {
    getAjv().compile(schema as object);
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}
```

---

### Task 10: Schema validate (payload against schema)

**Files:**
- Create: `packages/webhooks/src/schema/validate.ts`

- [ ] **Step 1: Write the validator**

```ts
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const compiled = new WeakMap<object, ValidateFunction>();

function compile(schema: object): ValidateFunction {
  let fn = compiled.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    compiled.set(schema, fn);
  }
  return fn;
}

export type ValidatePayloadResult =
  | { ok: true }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export function validatePayload(schema: unknown, payload: unknown): ValidatePayloadResult {
  if (schema === null || typeof schema !== "object") {
    return { ok: true }; // no schema = accept
  }
  const fn = compile(schema as object);
  if (fn(payload)) return { ok: true };
  const errors = (fn.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
  }));
  return { ok: false, errors };
}
```

---

### Task 11: Schema infer (from a sample payload)

**Files:**
- Create: `packages/webhooks/src/schema/infer.ts`

- [ ] **Step 1: Write the inferrer**

A small, dependency-free inferrer covering object/array/scalar shapes. Produces a draft schema users can refine in the UI.

```ts
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type InferOptions = {
  /** Maximum object/array depth to descend. Defaults to 6. */
  maxDepth?: number;
};

/**
 * Infer a permissive JSON Schema (draft-07) from one or more samples.
 * `additionalProperties` defaults to true so future provider changes don't
 * break ingest validation when callers raise it to "reject".
 */
export function inferSchema(sample: Json, opts: InferOptions = {}): object {
  const maxDepth = opts.maxDepth ?? 6;
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...inferNode(sample, maxDepth),
  };
}

function inferNode(value: Json, depth: number): Record<string, unknown> {
  if (depth <= 0) return {};
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "string") return { type: "string" };
  if (Array.isArray(value)) {
    const items = value.length === 0 ? {} : inferNode(value[0] as Json, depth - 1);
    return { type: "array", items };
  }
  // object
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    properties[k] = inferNode(v as Json, depth - 1);
    required.push(k);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}
```

---

### Task 12: Path walker

**Files:**
- Create: `packages/webhooks/src/extract/path.ts`

- [ ] **Step 1: Write the extractor**

A minimal dot-path walker supporting `$.a.b.c` and bare `a.b.c`. Array indices via `[0]` syntax. No JSONPath wildcards in v1 — keep it simple, the spec's `fromPath` is a small dot-path language.

```ts
/**
 * Read a value from `obj` using a JSON dot-path. Returns `undefined` when any
 * segment is missing. Examples: "$.foo.bar", "foo.bar", "items[0].name".
 */
export function readPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  if (p === "$") return obj;

  const segments: Array<string | number> = [];
  for (const part of p.split(".")) {
    if (!part) continue;
    // "items[0]" → "items", 0
    const m = part.match(/^([^[]+)((?:\[\d+\])*)$/);
    if (m) {
      segments.push(m[1]!);
      const idxs = m[2]!.match(/\[(\d+)\]/g) ?? [];
      for (const i of idxs) segments.push(Number(i.slice(1, -1)));
    } else {
      segments.push(part);
    }
  }

  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}
```

---

### Task 13: Event-type extractor

**Files:**
- Create: `packages/webhooks/src/extract/event-type.ts`

- [ ] **Step 1: Write the extractor**

```ts
import { readPath } from "./path.ts";

export type EventTypeSource = {
  /** Lowercased header map. */
  headers: Record<string, string>;
  payload: unknown;
};

/**
 * Resolve a webhook's `eventTypePath`:
 *   - "header:x-github-event" → headers["x-github-event"]
 *   - "$.webhookEvent"        → payload.webhookEvent
 *   - "$.type + '.' + $.action" → not supported in v1; return null.
 */
export function extractEventType(spec: string | undefined, src: EventTypeSource): string | null {
  if (!spec) return null;
  if (spec.startsWith("header:")) {
    const h = spec.slice("header:".length).toLowerCase();
    return src.headers[h] ?? null;
  }
  if (spec.startsWith("$") || spec.includes(".")) {
    const v = readPath(src.payload, spec);
    return typeof v === "string" ? v : v == null ? null : String(v);
  }
  return null;
}
```

---

### Task 14: Preset types

**Files:**
- Create: `packages/webhooks/src/presets/types.ts`

- [ ] **Step 1: Write the type module**

```ts
import type { PresetId, WebhookAuthConfig, WebhookCorrelationSuggestion, WebhookKind } from "@journeyman/core";

export type PresetManifest = {
  id: PresetId;
  name: string;
  kind: WebhookKind;
  icon?: string;
  docsUrl?: string;

  auth: WebhookAuthConfig;

  eventTypePath?: string;
  deliveryIdHeader?: string;

  knownEventTypes?: string[];
  correlationSuggestions?: WebhookCorrelationSuggestion[];

  /** Schema relative to the preset directory; loader replaces with the parsed object. */
  payloadSchemaRef?: string;

  /** Sample events relative to preset dir; loader leaves these as strings. */
  sampleEvents?: Record<string, string>;
};

export type LoadedPreset = Omit<PresetManifest, "payloadSchemaRef"> & {
  payloadSchema?: unknown;
  samples?: Record<string, unknown>;
};
```

---

### Task 15: Preset loader

**Files:**
- Create: `packages/webhooks/src/presets/loader.ts`

- [ ] **Step 1: Write the loader**

```ts
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PresetId } from "@journeyman/core";
import { lintJsonSchema } from "../schema/lint.ts";
import type { LoadedPreset, PresetManifest } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESETS_ROOT = resolve(HERE, "..", "..", "presets");

let cache: Map<PresetId, LoadedPreset> | null = null;

export function loadAllPresets(rootOverride?: string): Map<PresetId, LoadedPreset> {
  if (cache && !rootOverride) return cache;
  const root = rootOverride ?? PRESETS_ROOT;
  const out = new Map<PresetId, LoadedPreset>();

  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "preset.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PresetManifest;

    let payloadSchema: unknown = undefined;
    if (manifest.payloadSchemaRef) {
      const schemaPath = resolve(dir, manifest.payloadSchemaRef);
      payloadSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
      const lint = lintJsonSchema(payloadSchema);
      if (!lint.ok) {
        throw new Error(`Preset ${manifest.id} schema invalid: ${lint.errors.join("; ")}`);
      }
    }

    let samples: Record<string, unknown> | undefined;
    if (manifest.sampleEvents) {
      samples = {};
      for (const [event, rel] of Object.entries(manifest.sampleEvents)) {
        samples[event] = JSON.parse(readFileSync(resolve(dir, rel), "utf8"));
      }
    }

    const loaded: LoadedPreset = {
      id: manifest.id,
      name: manifest.name,
      kind: manifest.kind,
      icon: manifest.icon,
      docsUrl: manifest.docsUrl,
      auth: manifest.auth,
      eventTypePath: manifest.eventTypePath,
      deliveryIdHeader: manifest.deliveryIdHeader,
      knownEventTypes: manifest.knownEventTypes,
      correlationSuggestions: manifest.correlationSuggestions,
      payloadSchema,
      samples,
    };
    out.set(manifest.id, loaded);
  }

  if (!rootOverride) cache = out;
  return out;
}

export function getPreset(id: PresetId): LoadedPreset | undefined {
  return loadAllPresets().get(id);
}

export function listPresets(): LoadedPreset[] {
  return Array.from(loadAllPresets().values());
}
```

---

### Task 16: Preset bundles — GitHub family (3 presets)

**Files:**
- Create: `packages/webhooks/presets/github/preset.json`
- Create: `packages/webhooks/presets/github/schema.json`
- Create: `packages/webhooks/presets/github/samples/push.json`
- Create: `packages/webhooks/presets/github/samples/pull_request.json`
- Create: `packages/webhooks/presets/github-issues/preset.json`
- Create: `packages/webhooks/presets/github-issues/schema.json`
- Create: `packages/webhooks/presets/github-issues/samples/issues.json`
- Create: `packages/webhooks/presets/github-projects/preset.json`
- Create: `packages/webhooks/presets/github-projects/schema.json`
- Create: `packages/webhooks/presets/github-projects/samples/projects_v2_item.json`

- [ ] **Step 1: Create `presets/github/preset.json`**

```json
{
  "id": "github",
  "name": "GitHub (code events)",
  "kind": "git",
  "icon": "github.svg",
  "docsUrl": "https://docs.github.com/en/webhooks/webhook-events-and-payloads",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature-256",
    "prefix": "sha256=",
    "secretRef": ""
  },
  "eventTypePath": "header:x-github-event",
  "deliveryIdHeader": "x-github-delivery",
  "knownEventTypes": [
    "push", "pull_request", "pull_request_review", "pull_request_review_comment",
    "create", "delete", "release", "workflow_run", "check_run", "check_suite"
  ],
  "correlationSuggestions": [
    { "key": "issueRef",  "path": "$.repository.full_name" },
    { "key": "commitSha", "path": "$.after" },
    { "key": "branch",    "path": "$.ref" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": {
    "push": "./samples/push.json",
    "pull_request": "./samples/pull_request.json"
  }
}
```

- [ ] **Step 2: Create `presets/github/schema.json`**

Strict on the envelope, permissive deeper. The fields below are the ones Journeyman flows reference; any field GitHub adds later is silently allowed.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "ref":    { "type": "string" },
    "after":  { "type": "string" },
    "before": { "type": "string" },
    "repository": {
      "type": "object",
      "properties": {
        "id":        { "type": "integer" },
        "name":      { "type": "string" },
        "full_name": { "type": "string" },
        "owner": {
          "type": "object",
          "properties": { "login": { "type": "string" } },
          "additionalProperties": true
        }
      },
      "additionalProperties": true
    },
    "pull_request": {
      "type": "object",
      "properties": {
        "number": { "type": "integer" },
        "title":  { "type": "string" },
        "state":  { "type": "string" },
        "merged": { "type": "boolean" },
        "user": {
          "type": "object",
          "properties": { "login": { "type": "string" } },
          "additionalProperties": true
        },
        "head": {
          "type": "object",
          "properties": { "ref": { "type": "string" }, "sha": { "type": "string" } },
          "additionalProperties": true
        },
        "base": {
          "type": "object",
          "properties": { "ref": { "type": "string" }, "sha": { "type": "string" } },
          "additionalProperties": true
        }
      },
      "additionalProperties": true
    },
    "sender": {
      "type": "object",
      "properties": { "login": { "type": "string" } },
      "additionalProperties": true
    }
  },
  "additionalProperties": true
}
```

- [ ] **Step 3: Create `presets/github/samples/push.json`** with a minimal real-shape sample:

```json
{
  "ref": "refs/heads/main",
  "before": "0000000000000000000000000000000000000000",
  "after": "abc1234abc1234abc1234abc1234abc1234abc12",
  "repository": { "id": 1, "name": "demo", "full_name": "acme/demo", "owner": { "login": "acme" } },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 4: Create `presets/github/samples/pull_request.json`**

```json
{
  "action": "opened",
  "repository": { "id": 1, "name": "demo", "full_name": "acme/demo", "owner": { "login": "acme" } },
  "pull_request": {
    "number": 42,
    "title": "Add feature X",
    "state": "open",
    "merged": false,
    "user": { "login": "alice" },
    "head": { "ref": "feat/x", "sha": "deadbeef" },
    "base": { "ref": "main",   "sha": "cafebabe" }
  },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 5: Create `presets/github-issues/preset.json`**

```json
{
  "id": "github-issues",
  "name": "GitHub (issues)",
  "kind": "ticket",
  "icon": "github.svg",
  "docsUrl": "https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature-256",
    "prefix": "sha256=",
    "secretRef": ""
  },
  "eventTypePath": "header:x-github-event",
  "deliveryIdHeader": "x-github-delivery",
  "knownEventTypes": ["issues", "issue_comment", "label", "milestone"],
  "correlationSuggestions": [
    { "key": "issueRef", "path": "$.repository.full_name" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "issues": "./samples/issues.json" }
}
```

- [ ] **Step 6: Create `presets/github-issues/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "issue": {
      "type": "object",
      "properties": {
        "number": { "type": "integer" },
        "title":  { "type": "string" },
        "state":  { "type": "string" },
        "body":   { "type": ["string", "null"] },
        "user":   { "type": "object", "properties": { "login": { "type": "string" } }, "additionalProperties": true },
        "labels": { "type": "array", "items": { "type": "object", "additionalProperties": true } }
      },
      "additionalProperties": true
    },
    "comment": {
      "type": "object",
      "properties": {
        "id":   { "type": "integer" },
        "body": { "type": "string" },
        "user": { "type": "object", "properties": { "login": { "type": "string" } }, "additionalProperties": true }
      },
      "additionalProperties": true
    },
    "repository": {
      "type": "object",
      "properties": { "full_name": { "type": "string" } },
      "additionalProperties": true
    },
    "sender": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 7: Create `presets/github-issues/samples/issues.json`**

```json
{
  "action": "opened",
  "issue": {
    "number": 7,
    "title": "Bug: button does not click",
    "state": "open",
    "body": "Steps to reproduce...",
    "user": { "login": "alice" },
    "labels": [{ "name": "bug" }]
  },
  "repository": { "full_name": "acme/demo" },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 8: Create `presets/github-projects/preset.json`**

```json
{
  "id": "github-projects",
  "name": "GitHub (projects v2)",
  "kind": "ticket",
  "icon": "github.svg",
  "docsUrl": "https://docs.github.com/en/webhooks/webhook-events-and-payloads#projects_v2_item",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature-256",
    "prefix": "sha256=",
    "secretRef": ""
  },
  "eventTypePath": "header:x-github-event",
  "deliveryIdHeader": "x-github-delivery",
  "knownEventTypes": ["projects_v2_item", "projects_v2"],
  "correlationSuggestions": [
    { "key": "projectId", "path": "$.projects_v2_item.project_node_id" },
    { "key": "itemId",    "path": "$.projects_v2_item.node_id" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "projects_v2_item": "./samples/projects_v2_item.json" }
}
```

- [ ] **Step 9: Create `presets/github-projects/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "action": { "type": "string" },
    "projects_v2_item": {
      "type": "object",
      "properties": {
        "id":               { "type": "integer" },
        "node_id":          { "type": "string" },
        "project_node_id":  { "type": "string" },
        "content_type":     { "type": "string" },
        "content_node_id":  { "type": "string" }
      },
      "additionalProperties": true
    },
    "changes":    { "type": "object", "additionalProperties": true },
    "sender":     { "type": "object", "additionalProperties": true },
    "organization": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 10: Create `presets/github-projects/samples/projects_v2_item.json`**

```json
{
  "action": "edited",
  "projects_v2_item": {
    "id": 12345,
    "node_id": "PVTI_abc",
    "project_node_id": "PVT_xyz",
    "content_type": "Issue",
    "content_node_id": "I_kw"
  },
  "changes": { "field_value": { "field_node_id": "PVTF_status" } },
  "sender":  { "login": "alice" },
  "organization": { "login": "acme" }
}
```

---

### Task 17: Preset bundles — GitLab family (2 presets)

**Files:**
- Create: `packages/webhooks/presets/gitlab/preset.json`
- Create: `packages/webhooks/presets/gitlab/schema.json`
- Create: `packages/webhooks/presets/gitlab/samples/push.json`
- Create: `packages/webhooks/presets/gitlab-issues/preset.json`
- Create: `packages/webhooks/presets/gitlab-issues/schema.json`
- Create: `packages/webhooks/presets/gitlab-issues/samples/issue.json`

- [ ] **Step 1: Create `presets/gitlab/preset.json`**

```json
{
  "id": "gitlab",
  "name": "GitLab (code events)",
  "kind": "git",
  "icon": "gitlab.svg",
  "docsUrl": "https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html",
  "auth": { "mode": "header-equals", "header": "x-gitlab-token", "valueRef": "" },
  "eventTypePath": "$.object_kind",
  "knownEventTypes": ["push", "tag_push", "merge_request", "note", "pipeline", "job"],
  "correlationSuggestions": [
    { "key": "mrIid",     "path": "$.object_attributes.iid" },
    { "key": "commitSha", "path": "$.checkout_sha" },
    { "key": "branch",    "path": "$.ref" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "push": "./samples/push.json" }
}
```

- [ ] **Step 2: Create `presets/gitlab/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "object_kind":   { "type": "string" },
    "event_name":    { "type": "string" },
    "ref":           { "type": "string" },
    "checkout_sha":  { "type": ["string", "null"] },
    "project": {
      "type": "object",
      "properties": {
        "id":                  { "type": "integer" },
        "name":                { "type": "string" },
        "path_with_namespace": { "type": "string" }
      },
      "additionalProperties": true
    },
    "object_attributes": {
      "type": "object",
      "properties": {
        "iid":          { "type": "integer" },
        "title":        { "type": "string" },
        "state":        { "type": "string" },
        "source_branch":{ "type": "string" },
        "target_branch":{ "type": "string" }
      },
      "additionalProperties": true
    },
    "user": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 3: Create `presets/gitlab/samples/push.json`**

```json
{
  "object_kind": "push",
  "event_name": "push",
  "ref": "refs/heads/main",
  "checkout_sha": "abc1234",
  "project": { "id": 1, "name": "demo", "path_with_namespace": "acme/demo" },
  "user": { "username": "alice" }
}
```

- [ ] **Step 4: Create `presets/gitlab-issues/preset.json`**

```json
{
  "id": "gitlab-issues",
  "name": "GitLab (issues)",
  "kind": "ticket",
  "icon": "gitlab.svg",
  "docsUrl": "https://docs.gitlab.com/ee/user/project/integrations/webhook_events.html#issue-events",
  "auth": { "mode": "header-equals", "header": "x-gitlab-token", "valueRef": "" },
  "eventTypePath": "$.object_kind",
  "knownEventTypes": ["issue", "note"],
  "correlationSuggestions": [
    { "key": "issueIid",  "path": "$.object_attributes.iid" },
    { "key": "projectId", "path": "$.project.id" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "issue": "./samples/issue.json" }
}
```

- [ ] **Step 5: Create `presets/gitlab-issues/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "object_kind": { "type": "string" },
    "event_type":  { "type": "string" },
    "project": {
      "type": "object",
      "properties": {
        "id":                  { "type": "integer" },
        "path_with_namespace": { "type": "string" }
      },
      "additionalProperties": true
    },
    "object_attributes": {
      "type": "object",
      "properties": {
        "id":          { "type": "integer" },
        "iid":         { "type": "integer" },
        "title":       { "type": "string" },
        "description": { "type": ["string", "null"] },
        "state":       { "type": "string" },
        "noteable_type": { "type": "string" }
      },
      "additionalProperties": true
    },
    "user": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 6: Create `presets/gitlab-issues/samples/issue.json`**

```json
{
  "object_kind": "issue",
  "event_type": "issue",
  "project": { "id": 1, "path_with_namespace": "acme/demo" },
  "object_attributes": { "id": 99, "iid": 7, "title": "Demo issue", "description": "...", "state": "opened" },
  "user": { "username": "alice" }
}
```

---

### Task 18: Preset bundles — Bitbucket family (2 presets)

**Files:**
- Create: `packages/webhooks/presets/bitbucket/preset.json`
- Create: `packages/webhooks/presets/bitbucket/schema.json`
- Create: `packages/webhooks/presets/bitbucket/samples/pullrequest_created.json`
- Create: `packages/webhooks/presets/bitbucket-issues/preset.json`
- Create: `packages/webhooks/presets/bitbucket-issues/schema.json`
- Create: `packages/webhooks/presets/bitbucket-issues/samples/issue_created.json`

- [ ] **Step 1: Create `presets/bitbucket/preset.json`**

```json
{
  "id": "bitbucket",
  "name": "Bitbucket (code events)",
  "kind": "git",
  "icon": "bitbucket.svg",
  "docsUrl": "https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature",
    "prefix": "sha256=",
    "secretRef": ""
  },
  "eventTypePath": "header:x-event-key",
  "deliveryIdHeader": "x-request-uuid",
  "knownEventTypes": [
    "repo:push",
    "pullrequest:created", "pullrequest:updated",
    "pullrequest:approved", "pullrequest:fulfilled", "pullrequest:rejected"
  ],
  "correlationSuggestions": [
    { "key": "prId",      "path": "$.pullrequest.id" },
    { "key": "commitSha", "path": "$.push.changes[0].new.target.hash" },
    { "key": "branch",    "path": "$.push.changes[0].new.name" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "pullrequest_created": "./samples/pullrequest_created.json" }
}
```

- [ ] **Step 2: Create `presets/bitbucket/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "repository": {
      "type": "object",
      "properties": { "full_name": { "type": "string" }, "name": { "type": "string" } },
      "additionalProperties": true
    },
    "pullrequest": {
      "type": "object",
      "properties": {
        "id":    { "type": "integer" },
        "title": { "type": "string" },
        "state": { "type": "string" },
        "author": { "type": "object", "additionalProperties": true },
        "source": { "type": "object", "additionalProperties": true },
        "destination": { "type": "object", "additionalProperties": true }
      },
      "additionalProperties": true
    },
    "push": { "type": "object", "additionalProperties": true },
    "actor": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 3: Create `presets/bitbucket/samples/pullrequest_created.json`**

```json
{
  "repository": { "full_name": "acme/demo", "name": "demo" },
  "pullrequest": {
    "id": 5,
    "title": "Add feature X",
    "state": "OPEN",
    "author": { "display_name": "Alice" },
    "source": { "branch": { "name": "feat/x" } },
    "destination": { "branch": { "name": "main" } }
  },
  "actor": { "display_name": "Alice" }
}
```

- [ ] **Step 4: Create `presets/bitbucket-issues/preset.json`**

```json
{
  "id": "bitbucket-issues",
  "name": "Bitbucket (issues)",
  "kind": "ticket",
  "icon": "bitbucket.svg",
  "docsUrl": "https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/#Issue",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature",
    "prefix": "sha256=",
    "secretRef": ""
  },
  "eventTypePath": "header:x-event-key",
  "deliveryIdHeader": "x-request-uuid",
  "knownEventTypes": ["issue:created", "issue:updated", "issue:comment_created"],
  "correlationSuggestions": [
    { "key": "issueId", "path": "$.issue.id" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "issue_created": "./samples/issue_created.json" }
}
```

- [ ] **Step 5: Create `presets/bitbucket-issues/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "repository": {
      "type": "object",
      "properties": { "full_name": { "type": "string" } },
      "additionalProperties": true
    },
    "issue": {
      "type": "object",
      "properties": {
        "id":       { "type": "integer" },
        "title":    { "type": "string" },
        "state":    { "type": "string" },
        "kind":     { "type": "string" },
        "priority": { "type": "string" }
      },
      "additionalProperties": true
    },
    "comment": { "type": "object", "additionalProperties": true },
    "actor": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 6: Create `presets/bitbucket-issues/samples/issue_created.json`**

```json
{
  "repository": { "full_name": "acme/demo" },
  "issue": { "id": 11, "title": "Login bug", "state": "new", "kind": "bug", "priority": "major" },
  "actor": { "display_name": "Alice" }
}
```

---

### Task 19: Preset bundles — Jira, Linear, Monday (3 presets)

**Files:**
- Create: `packages/webhooks/presets/jira/preset.json`
- Create: `packages/webhooks/presets/jira/schema.json`
- Create: `packages/webhooks/presets/jira/samples/issue_updated.json`
- Create: `packages/webhooks/presets/linear/preset.json`
- Create: `packages/webhooks/presets/linear/schema.json`
- Create: `packages/webhooks/presets/linear/samples/issue_create.json`
- Create: `packages/webhooks/presets/monday/preset.json`
- Create: `packages/webhooks/presets/monday/schema.json`
- Create: `packages/webhooks/presets/monday/samples/create_pulse.json`

- [ ] **Step 1: Create `presets/jira/preset.json`**

```json
{
  "id": "jira",
  "name": "Jira Cloud",
  "kind": "ticket",
  "icon": "jira.svg",
  "docsUrl": "https://developer.atlassian.com/cloud/jira/platform/webhooks/",
  "auth": { "mode": "header-equals", "header": "authorization", "valueRef": "" },
  "eventTypePath": "$.webhookEvent",
  "deliveryIdHeader": "x-atlassian-webhook-identifier",
  "knownEventTypes": [
    "jira:issue_created", "jira:issue_updated", "jira:issue_deleted",
    "comment_created", "comment_updated", "comment_deleted",
    "worklog_created", "worklog_updated"
  ],
  "correlationSuggestions": [
    { "key": "issueKey", "path": "$.issue.key" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "issue_updated": "./samples/issue_updated.json" }
}
```

- [ ] **Step 2: Create `presets/jira/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "webhookEvent": { "type": "string" },
    "timestamp":    { "type": "integer" },
    "issue": {
      "type": "object",
      "properties": {
        "id":  { "type": "string" },
        "key": { "type": "string" },
        "fields": {
          "type": "object",
          "properties": {
            "summary":     { "type": "string" },
            "status":      { "type": "object", "additionalProperties": true },
            "issuetype":   { "type": "object", "additionalProperties": true },
            "assignee":    { "type": ["object", "null"], "additionalProperties": true },
            "reporter":    { "type": ["object", "null"], "additionalProperties": true },
            "description": { "type": ["string", "null"] }
          },
          "additionalProperties": true
        }
      },
      "additionalProperties": true
    },
    "user":    { "type": "object", "additionalProperties": true },
    "comment": { "type": "object", "additionalProperties": true },
    "changelog": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": true
}
```

- [ ] **Step 3: Create `presets/jira/samples/issue_updated.json`**

```json
{
  "webhookEvent": "jira:issue_updated",
  "timestamp": 1700000000000,
  "issue": {
    "id": "10001",
    "key": "DEMO-7",
    "fields": {
      "summary": "Fix login button",
      "status": { "name": "In Progress" },
      "issuetype": { "name": "Bug" },
      "assignee": { "displayName": "Alice" },
      "reporter": { "displayName": "Bob" }
    }
  },
  "user": { "displayName": "Bob" },
  "changelog": { "items": [{ "field": "status", "fromString": "To Do", "toString": "In Progress" }] }
}
```

- [ ] **Step 4: Create `presets/linear/preset.json`**

```json
{
  "id": "linear",
  "name": "Linear",
  "kind": "ticket",
  "icon": "linear.svg",
  "docsUrl": "https://developers.linear.app/docs/graphql/webhooks",
  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "linear-signature",
    "secretRef": ""
  },
  "eventTypePath": "$.type",
  "deliveryIdHeader": "linear-delivery",
  "knownEventTypes": ["Issue", "Comment", "Project", "Cycle"],
  "correlationSuggestions": [
    { "key": "issueIdentifier", "path": "$.data.identifier" },
    { "key": "teamId",          "path": "$.data.team.id" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "issue_create": "./samples/issue_create.json" }
}
```

- [ ] **Step 5: Create `presets/linear/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "action":     { "type": "string" },
    "type":       { "type": "string" },
    "createdAt":  { "type": "string" },
    "data": {
      "type": "object",
      "properties": {
        "id":         { "type": "string" },
        "identifier": { "type": "string" },
        "title":      { "type": "string" },
        "state":      { "type": "object", "additionalProperties": true },
        "team":       { "type": "object", "additionalProperties": true },
        "assignee":   { "type": ["object", "null"], "additionalProperties": true }
      },
      "additionalProperties": true
    },
    "url": { "type": "string" }
  },
  "additionalProperties": true
}
```

- [ ] **Step 6: Create `presets/linear/samples/issue_create.json`**

```json
{
  "action": "create",
  "type": "Issue",
  "createdAt": "2026-01-01T12:00:00.000Z",
  "data": {
    "id": "abcdef",
    "identifier": "ENG-7",
    "title": "Fix login",
    "state": { "name": "Todo" },
    "team": { "id": "team_1", "name": "Engineering" }
  },
  "url": "https://linear.app/acme/issue/ENG-7"
}
```

- [ ] **Step 7: Create `presets/monday/preset.json`**

```json
{
  "id": "monday",
  "name": "monday.com",
  "kind": "ticket",
  "icon": "monday.svg",
  "docsUrl": "https://developer.monday.com/apps/docs/webhook",
  "auth": {
    "mode": "jwt",
    "algo": "HS256",
    "header": "authorization",
    "stripPrefix": "",
    "signingKeyRef": ""
  },
  "eventTypePath": "$.event.type",
  "knownEventTypes": [
    "create_pulse", "change_column_value", "update_column_value",
    "create_update", "change_status_column_value"
  ],
  "correlationSuggestions": [
    { "key": "pulseId", "path": "$.event.pulseId" },
    { "key": "boardId", "path": "$.event.boardId" }
  ],
  "payloadSchemaRef": "./schema.json",
  "sampleEvents": { "create_pulse": "./samples/create_pulse.json" }
}
```

- [ ] **Step 8: Create `presets/monday/schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "event": {
      "type": "object",
      "properties": {
        "type":       { "type": "string" },
        "boardId":    { "type": "integer" },
        "pulseId":    { "type": "integer" },
        "pulseName":  { "type": "string" },
        "groupId":    { "type": "string" },
        "columnId":   { "type": "string" },
        "userId":     { "type": "integer" },
        "value":      {},
        "previousValue": {}
      },
      "additionalProperties": true
    }
  },
  "required": ["event"],
  "additionalProperties": true
}
```

- [ ] **Step 9: Create `presets/monday/samples/create_pulse.json`**

```json
{
  "event": {
    "type": "create_pulse",
    "boardId": 1234,
    "pulseId": 5678,
    "pulseName": "New task",
    "groupId": "topics",
    "userId": 99
  }
}
```

---

### Task 20: Preset bundle — Generic

**Files:**
- Create: `packages/webhooks/presets/generic/preset.json`

- [ ] **Step 1: Create `presets/generic/preset.json`**

```json
{
  "id": "generic",
  "name": "Generic (custom)",
  "kind": "ticket",
  "auth": { "mode": "none" },
  "knownEventTypes": [],
  "correlationSuggestions": []
}
```

No schema and no samples — user supplies. The `kind` here is a starting value; the UI lets the user flip it to `git` on creation.

---

### Task 21: Wire up package public exports

**Files:**
- Modify: `packages/webhooks/src/index.ts`

- [ ] **Step 1: Write the public surface**

```ts
// Auth
export { verifyWebhookRequest } from "./auth/verify.ts";
export type { VerifyInput, VerifyResult } from "./auth/verify.ts";

// Schema
export { lintJsonSchema } from "./schema/lint.ts";
export type { LintResult } from "./schema/lint.ts";
export { validatePayload } from "./schema/validate.ts";
export type { ValidatePayloadResult } from "./schema/validate.ts";
export { inferSchema } from "./schema/infer.ts";
export type { InferOptions } from "./schema/infer.ts";

// Extract
export { readPath } from "./extract/path.ts";
export { extractEventType } from "./extract/event-type.ts";
export type { EventTypeSource } from "./extract/event-type.ts";

// Presets
export { loadAllPresets, getPreset, listPresets } from "./presets/loader.ts";
export type { PresetManifest, LoadedPreset } from "./presets/types.ts";
```

---

### Task 22: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Install dependencies if not already**

Run from the repo root:

```bash
npm install
```

Expected: `ajv`, `ajv-formats`, `jose` resolve under `packages/webhooks/node_modules` (or hoisted to the root). No peer warnings about missing `@journeyman/core`.

- [ ] **Step 2: Typecheck the new package in isolation**

```bash
npm run typecheck -w @journeyman/webhooks
```

Expected: zero errors.

- [ ] **Step 3: Typecheck the whole repo**

```bash
npm run typecheck
```

Expected: zero errors. (The `@journeyman/core` changes from Task 3 ripple to every consumer; if anything broke, it will surface here.)

- [ ] **Step 4: Check import boundaries**

```bash
npm run check:boundaries
```

Expected: `OK` — no violations. The new package is registered as `backend` (Task 2) and only imports from `@journeyman/core` (shared) and external deps, both of which are allowed.

- [ ] **Step 5: Run the combined gate**

```bash
npm run check
```

Expected: passes both steps cleanly. This is the foundation plan's acceptance gate.

---

## Plan Self-Review

**Spec coverage** (Foundation portion only — backend/HTTP/UI are out of scope for this plan):

| Spec section | Task(s) |
|---|---|
| Webhook resource type (`Webhook`, `WebhookAuthConfig`, `WebhookScope`, `Webhook*` helpers) | 3 |
| Four security modes (`none`, `header-equals`, `hmac`, `jwt`) | 5, 6, 7 |
| Timing-safe compare | 4 |
| HMAC + timestamp sub-mode | 6 |
| JWT HS256 + RS256/ES256 via JWKS, caching | 7 |
| Auth dispatcher | 8 |
| JSON Schema lint (validate schema docs) | 9 |
| JSON Schema validation of payloads | 10 |
| Schema inference from sample | 11 |
| Path / event-type extraction | 12, 13 |
| Preset manifest type | 14 |
| Preset loader (filesystem, cache, lint on load) | 15 |
| 11 preset bundles | 16, 17, 18, 19, 20 |
| Package wiring, import boundary registration | 1, 2, 21 |
| Verification gate (typecheck + boundaries) | 22 |

Out of scope (next plans): DB migration, `IWebhookStore`, ingest route, CRUD routes, legacy `/webhooks/:provider` shim, test-delivery service, data backfill (plan 2). Webhook management UI, schema editor, `WebhookWaitConfigEditor` extension (plan 3).

**Placeholder scan:** None — every code step contains the full text. Preset `secretRef`/`valueRef`/`signingKeyRef` values are empty strings by design (resolved at webhook-create time in plan 2, not in the preset bundle). `monday` preset has empty `stripPrefix` because Monday sends bare JWTs.

**Type consistency:** `VerifyInput`, `VerifyResult` defined in Task 8 and consumed by Tasks 5–7 — all reference the same shape. `LoadedPreset` defined in Task 14, returned by Task 15, re-exported in Task 21 — consistent. `PresetId` and `WebhookAuthConfig` come from `@journeyman/core` (Task 3) and used everywhere else by name — consistent.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-webhook-management-foundation.md`](2026-05-25-webhook-management-foundation.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for catching direction issues early.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
