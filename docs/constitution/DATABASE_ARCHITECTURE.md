# DATABASE_ARCHITECTURE.md — Schema, Diagrams & Patterns

Linked from [AGENTS.md](../../AGENTS.md). Covers PostgreSQL schema design, entity relationships, key interaction sequences, and recurring patterns every contributor must understand.

---

## Overview

| Property | Value |
|---|---|
| **Engine** | PostgreSQL 16 (Alpine) |
| **Access** | Direct SQL via `node-postgres` (`pg`) — no ORM |
| **Host port (dev)** | 5433 |
| **Connection** | `DATABASE_URL` environment variable |
| **Schema versioning** | Append-only numbered migrations in `packages/migrations/` |
| **Encryption** | AES-256-GCM applied in the application layer (`packages/secrets`) |

All 32 migrations are idempotent, numbered sequentially, and tracked in `jm_schema_migrations`. Once merged to `master`, a migration is **permanent** — roll forward with a new migration, never backwards.

---

## Table Catalog

### Identity & Tenancy

| Table | Purpose |
|---|---|
| `jm_orgs` | Tenant organisations |
| `jm_users` | Platform user accounts |
| `jm_auth_identities` | Per-provider credentials (password hash, OAuth token, etc.) |
| `jm_memberships` | User ↔ org role assignments |
| `jm_refresh_tokens` | Short-lived session refresh tokens |
| `jm_api_tokens` | Long-lived programmatic API credentials |
| `jm_system_state` | Bootstrap marker (e.g. initial admin created) |

### Secrets

| Table | Purpose |
|---|---|
| `jm_secrets` | Org/user-scoped encrypted credentials. Stores `ciphertext`, `iv`, and `auth_tag` as `BYTEA`; decrypted only in `packages/secrets/src/crypto.ts`. |

### Workflow Definitions

| Table | Purpose |
|---|---|
| `jm_workflows` | Workflow metadata, status (`draft`/`ready`), scope (`user`/`org`/`global`) |
| `jm_workflow_versions` | Immutable snapshots of a workflow graph (nodes, edges, config) stored as JSONB |
| `jm_workflow_grants` | Principal-based ACL for a workflow (`user`/`org`/`global` × `owner`/`editor`/`viewer`) |
| `jm_workflow_triggers` | Index of active trigger nodes (kind: `manual`/`webhook`/`human`) per workflow version |

### Workflow Execution

| Table | Purpose |
|---|---|
| `jm_workflow_instances` | Each run of a workflow; holds definition snapshot, status, inputs/outputs |
| `jm_workflow_instance_events` | Append-only event log per instance (BIGSERIAL for strict ordering) |
| `jm_workflow_instance_grants` | Per-run ACL mirroring workflow grant shape |
| `jm_node_executions` | Per-node execution record including retry attempt, I/O, Conductor task ID, and webhook-wait correlation data |
| `jm_human_task_resolutions` | Resolution audit: outcome, source (`manual`/`timeout`), actor, payload |
| `jm_form_submissions` | Raw form values submitted for Human Task nodes |

### Webhooks

| Table | Purpose |
|---|---|
| `jm_webhooks` | Webhook endpoint configurations (preset, kind, HMAC auth, payload schema, schema validation mode) |
| `jm_webhook_events` | Inbound webhook payloads with processing status |

### Integrations

| Table | Purpose |
|---|---|
| `jm_mcp_instances` | MCP server configurations (stdio/http/sse transport, env-var bindings to secrets, system prompt) |
| `jm_skill_packages` | Git-based skill package registry (install status, enabled skills, CLI type) |
| `jm_custom_ai_steps` | User/org-defined AI step templates (prompt, input fields, output schema, tool/MCP/skill defaults) |
| `jm_coding_models` | Admin-managed AI model catalog (provider, model ID, capabilities, enabled/deprecated/default flags) |
| `jm_schema_migrations` | Applied migration log — do not edit manually |

---

## ER Diagram

> Rendered by any Mermaid-compatible viewer (GitHub, GitLab, VS Code with Mermaid extension).

### Cluster 1 — Identity & Tenancy

```mermaid
erDiagram
    jm_orgs {
        uuid id PK
        text slug
        text name
        timestamptz created_at
    }
    jm_users {
        uuid id PK
        text username
        text display_name
        text status
        bool is_platform_admin
        timestamptz created_at
        timestamptz updated_at
    }
    jm_auth_identities {
        uuid id PK
        uuid user_id FK
        text provider
        text provider_id
        text password_hash
        timestamptz created_at
        timestamptz updated_at
    }
    jm_memberships {
        uuid id PK
        uuid user_id FK
        uuid org_id FK
        text role
        timestamptz created_at
    }
    jm_refresh_tokens {
        uuid id PK
        uuid user_id FK
        text token_hash
        timestamptz expires_at
        timestamptz revoked_at
        timestamptz created_at
    }
    jm_api_tokens {
        uuid id PK
        uuid user_id FK
        uuid org_id FK
        text name
        text token_hash
        timestamptz last_used_at
        timestamptz expires_at
        timestamptz created_at
    }

    jm_orgs ||--o{ jm_memberships : "has members"
    jm_users ||--o{ jm_memberships : "belongs to orgs"
    jm_users ||--o{ jm_auth_identities : "has credentials"
    jm_users ||--o{ jm_refresh_tokens : "has sessions"
    jm_users ||--o{ jm_api_tokens : "has API keys"
    jm_orgs ||--o{ jm_api_tokens : "scopes API keys"
```

### Cluster 2 — Secrets, MCP & Skills (Scoped Resources)

```mermaid
erDiagram
    jm_orgs {
        uuid id PK
        text slug
    }
    jm_users {
        uuid id PK
        text username
    }
    jm_secrets {
        uuid id PK
        text scope
        uuid org_id FK
        uuid user_id FK
        text name
        bytea ciphertext
        bytea iv
        bytea auth_tag
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }
    jm_mcp_instances {
        uuid id PK
        text scope
        uuid org_id FK
        uuid user_id FK
        text name
        text transport
        text command
        jsonb args
        text url
        jsonb bindings
        text system_prompt
        bool enabled
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }
    jm_skill_packages {
        uuid id PK
        text scope
        uuid org_id FK
        uuid user_id FK
        text git_url
        text name
        text install_status
        text cli_type
        text[] enabled_skills
        timestamptz created_at
        timestamptz updated_at
    }
    jm_custom_ai_steps {
        uuid id PK
        text scope
        uuid org_id FK
        uuid user_id FK
        text name
        text icon
        jsonb input_fields
        text output_mode
        jsonb output_schema
        text prompt_template
        jsonb default_tools
        jsonb default_mcp_ids
        jsonb default_skill_ids
        bool requires_skills
        bool requires_mcp
        jsonb slots
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    jm_orgs ||--o{ jm_secrets : "owns (org-scope)"
    jm_users |o--o{ jm_secrets : "owns (user-scope)"
    jm_orgs ||--o{ jm_mcp_instances : "owns (org-scope)"
    jm_users |o--o{ jm_mcp_instances : "owns (user-scope)"
    jm_orgs ||--o{ jm_skill_packages : "owns (org-scope)"
    jm_users |o--o{ jm_skill_packages : "owns (user-scope)"
    jm_orgs ||--o{ jm_custom_ai_steps : "owns (org-scope)"
    jm_users |o--o{ jm_custom_ai_steps : "owns (user-scope)"
```

### Cluster 3 — Workflow Definitions & Grants

```mermaid
erDiagram
    jm_workflows {
        uuid id PK
        text name
        text status
        text scope
        uuid current_version_id FK
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }
    jm_workflow_versions {
        uuid id PK
        uuid workflow_id FK
        int version_number
        jsonb definition
        uuid created_by FK
        timestamptz created_at
    }
    jm_workflow_grants {
        uuid id PK
        uuid workflow_id FK
        text principal_type
        uuid principal_id
        text role
        uuid created_by FK
        timestamptz created_at
    }
    jm_workflow_triggers {
        uuid id PK
        uuid workflow_id FK
        uuid version_id FK
        text trigger_id
        text kind
        timestamptz created_at
    }

    jm_workflows ||--o{ jm_workflow_versions : "has versions"
    jm_workflows ||--o{ jm_workflow_grants : "has ACL"
    jm_workflows ||--o{ jm_workflow_triggers : "has triggers"
    jm_workflow_versions ||--o{ jm_workflow_triggers : "scoped to version"
```

### Cluster 4 — Workflow Execution

```mermaid
erDiagram
    jm_workflows {
        uuid id PK
        text name
    }
    jm_workflow_versions {
        uuid id PK
        uuid workflow_id FK
    }
    jm_webhook_events {
        uuid id PK
        uuid webhook_id FK
        text provider
        text event_type
        jsonb raw_payload
        text status
        timestamptz received_at
    }
    jm_form_submissions {
        uuid id PK
        uuid workflow_instance_id FK
        jsonb raw_values
        uuid submitted_by FK
        timestamptz submitted_at
    }
    jm_workflow_instances {
        uuid id PK
        uuid workflow_id FK
        uuid workflow_version_id FK
        text status
        text trigger_source
        uuid started_by FK
        int attempt_number
        uuid webhook_event_id FK
        text trigger_node_id
        uuid form_submission_id FK
        jsonb inputs
        jsonb outputs
        timestamptz started_at
        timestamptz completed_at
        int duration_ms
    }
    jm_workflow_instance_events {
        bigint id PK
        uuid workflow_instance_id FK
        text node_id
        text event_type
        jsonb payload
        timestamptz ts
    }
    jm_workflow_instance_grants {
        uuid id PK
        uuid workflow_instance_id FK
        text principal_type
        uuid principal_id
        text role
        uuid created_by FK
        timestamptz created_at
    }
    jm_node_executions {
        uuid id PK
        uuid workflow_instance_id FK
        text node_id
        int attempt
        text status
        text conductor_task_id
        text correlation_event_path
        text correlation_value
        jsonb input
        jsonb output
        text error_class
        text error_message
        timestamptz started_at
        timestamptz completed_at
    }
    jm_human_task_resolutions {
        uuid id PK
        uuid node_execution_id FK
        text outcome
        text source
        text resolved_by
        jsonb payload
        timestamptz resolved_at
    }

    jm_workflows ||--o{ jm_workflow_instances : "has runs"
    jm_workflow_versions ||--o{ jm_workflow_instances : "defines run"
    jm_webhook_events |o--o{ jm_workflow_instances : "triggered by"
    jm_form_submissions |o--|| jm_workflow_instances : "submitted for"
    jm_workflow_instances ||--o{ jm_workflow_instance_events : "event log"
    jm_workflow_instances ||--o{ jm_workflow_instance_grants : "has ACL"
    jm_workflow_instances ||--o{ jm_node_executions : "has node runs"
    jm_workflow_instances ||--o{ jm_form_submissions : "has submissions"
    jm_node_executions |o--|| jm_human_task_resolutions : "resolved by"
```

### Cluster 5 — Webhooks

```mermaid
erDiagram
    jm_orgs {
        uuid id PK
    }
    jm_users {
        uuid id PK
    }
    jm_webhooks {
        uuid id PK
        text scope
        uuid org_id FK
        uuid user_id FK
        text name
        text preset
        text kind
        text tenant_token
        text ingest_url
        jsonb auth
        jsonb payload_schema
        text schema_validation
        text event_type_path
        text delivery_id_header
        timestamptz last_event_at
        timestamptz created_at
        timestamptz updated_at
    }
    jm_webhook_events {
        uuid id PK
        uuid webhook_id FK
        text provider
        text event_type
        text delivery_id
        jsonb raw_headers
        jsonb raw_payload
        text status
        text error
        timestamptz received_at
    }

    jm_orgs ||--o{ jm_webhooks : "owns (org-scope)"
    jm_users |o--o{ jm_webhooks : "owns (user-scope)"
    jm_webhooks ||--o{ jm_webhook_events : "receives events"
```

---

## Sequence Diagrams

### 1 — Manual Workflow Run

A user triggers a workflow run via the API. The API gateway validates, creates the instance, and hands off to Conductor through the worker.

```mermaid
sequenceDiagram
    actor User
    participant API as api-server
    participant DB as PostgreSQL
    participant Worker as orchestrator/worker
    participant Conductor

    User->>API: POST /api/workflows/:id/run { inputs }
    API->>DB: SELECT jm_workflows + jm_workflow_versions (current)
    DB-->>API: workflow + version definition
    API->>DB: INSERT jm_workflow_instances (status=pending, trigger_source=manual)
    API->>DB: INSERT jm_workflow_instance_grants (owner)
    DB-->>API: instance record
    API-->>User: 202 { instanceId }

    Worker->>Conductor: startWorkflow(workflowId, instanceId)
    Conductor-->>Worker: engineWorkflowId
    Worker->>DB: UPDATE jm_workflow_instances SET status=running, engine_workflow_id=...

    loop per node
        Conductor->>Worker: poll task
        Worker->>DB: INSERT jm_node_executions (status=running)
        Worker->>DB: INSERT jm_workflow_instance_events (node_started)
        Note over Worker: execute step logic (AI, git, ticket, etc.)
        Worker->>DB: UPDATE jm_node_executions (status=completed, output=...)
        Worker->>DB: INSERT jm_workflow_instance_events (node_completed)
        Worker->>Conductor: complete task
    end

    Conductor->>Worker: workflow completed
    Worker->>DB: UPDATE jm_workflow_instances (status=completed, outputs=..., completed_at=now())
```

### 2 — Webhook-Triggered Workflow Run

An external system (GitHub, Jira, Linear, etc.) sends a webhook. The ingest endpoint verifies, stores the event, matches it to a workflow trigger, and starts a run.

```mermaid
sequenceDiagram
    actor External as External System
    participant API as api-server (ingest)
    participant DB as PostgreSQL
    participant Worker as orchestrator/worker
    participant Conductor

    External->>API: POST /ingest/:tenantToken (webhook payload)
    API->>DB: SELECT jm_webhooks WHERE tenant_token=...
    DB-->>API: webhook config (auth, schema_validation, preset)
    API->>API: verify HMAC signature
    API->>DB: INSERT jm_webhook_events (status=received, raw_payload=...)
    DB-->>API: event record

    API->>DB: SELECT jm_workflow_triggers WHERE kind=webhook AND webhookId matches
    DB-->>API: matching trigger(s)
    API->>API: evaluate acceptIf (JSONLogic) + extract inputs via inputsMapping

    API->>DB: INSERT jm_workflow_instances (trigger_source=webhook, webhook_event_id=...)
    API->>DB: UPDATE jm_webhook_events SET status=processed
    API-->>External: 200 OK

    Worker->>Conductor: startWorkflow(...)
    Note over Worker,Conductor: same node execution loop as manual run
    Worker->>DB: UPDATE jm_workflow_instances (status=completed)
```

### 3 — Human Task Pause & Resume

A workflow reaches a `human-task` node. The orchestrator pauses via Conductor, the API exposes the task for a human to resolve, and the resolution unblocks the workflow.

```mermaid
sequenceDiagram
    participant Worker as orchestrator/worker
    participant Conductor
    participant DB as PostgreSQL
    participant API as api-server
    actor Human

    Worker->>DB: INSERT jm_node_executions (status=waiting, conductor_task_id=...)
    Worker->>DB: INSERT jm_workflow_instance_events (human_task_pending)
    Worker->>DB: UPDATE jm_workflow_instances (status=paused)
    Worker->>Conductor: pause task (wait for external signal)
    Note over Worker: optional Slack notify sent by step

    Human->>API: GET /api/instances/:id/pending-human-tasks
    API->>DB: SELECT jm_node_executions WHERE status=waiting
    DB-->>API: task list + form config
    API-->>Human: task details + form fields

    Human->>API: POST /api/instances/:id/human-tasks/:nodeId/resolve { outcome, ...formValues }
    API->>DB: INSERT jm_form_submissions (raw_values=..., submitted_by=userId)
    API->>DB: INSERT jm_human_task_resolutions (outcome, source=manual, resolved_by=userId)
    API->>DB: UPDATE jm_node_executions (status=completed)
    API->>Conductor: complete task (signal workflow to resume)

    Conductor->>Worker: resume workflow
    Worker->>DB: UPDATE jm_workflow_instances (status=running)
    Worker->>DB: INSERT jm_workflow_instance_events (human_task_resolved)
    Note over Worker,Conductor: workflow continues from next node
```

### 4 — Webhook-Wait Correlation

A workflow pauses at a `webhook-wait` node and resumes when a matching inbound webhook arrives and satisfies the correlation condition.

```mermaid
sequenceDiagram
    participant Worker as orchestrator/worker
    participant Conductor
    participant DB as PostgreSQL
    participant API as api-server (ingest)
    actor External as External System

    Worker->>DB: INSERT jm_node_executions (status=waiting, correlation_event_path=..., correlation_value=...)
    Worker->>DB: UPDATE jm_workflow_instances (status=paused)
    Worker->>Conductor: pause task

    External->>API: POST /ingest/:tenantToken (webhook payload)
    API->>DB: INSERT jm_webhook_events (status=received)
    API->>DB: SELECT jm_node_executions WHERE status=waiting AND correlation matches
    DB-->>API: matching node execution(s)

    API->>DB: UPDATE jm_workflow_instance_events (webhook_correlation_matched)
    API->>DB: UPDATE jm_node_executions (status=completed, output=extracted_value)
    API->>DB: UPDATE jm_webhook_events (status=processed)
    API->>Conductor: complete task (signal)

    Conductor->>Worker: resume workflow
    Worker->>DB: UPDATE jm_workflow_instances (status=running)
```

### 5 — Secret Retrieval During Step Execution

A step that needs an external credential reads from the secrets vault. Decryption happens entirely in the application layer.

```mermaid
sequenceDiagram
    participant Worker as orchestrator/worker
    participant SecretsLib as @journeyman/secrets
    participant DB as PostgreSQL
    participant Crypto as crypto (AES-256-GCM)

    Worker->>SecretsLib: resolveSecret(name, { orgId, userId })
    SecretsLib->>DB: SELECT jm_secrets WHERE name=? AND (org_id=? OR user_id=?)
    DB-->>SecretsLib: { ciphertext BYTEA, iv BYTEA, auth_tag BYTEA }
    SecretsLib->>Crypto: decrypt(ciphertext, iv, auth_tag, JM_SECRET_ENCRYPTION_KEY)
    Crypto-->>SecretsLib: plaintext value
    SecretsLib-->>Worker: plaintext credential
    Note over Worker: credential used for external API call, never logged or persisted
```

---

## Key Design Patterns

### Scope Pattern (multi-tenancy)

All user/org-scoped resources share the same shape. A `UNIQUE NULLS NOT DISTINCT` constraint ensures uniqueness within a scope without special-casing nulls.

```sql
scope  TEXT NOT NULL CHECK (scope IN ('user', 'org'))
org_id UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE
user_id UUID            REFERENCES jm_users(id) ON DELETE CASCADE
-- user_id is NULL for org-scope rows, populated for user-scope
UNIQUE NULLS NOT DISTINCT (scope, org_id, user_id, name)
```

Tables using this pattern: `jm_secrets`, `jm_mcp_instances`, `jm_skill_packages`, `jm_custom_ai_steps`, `jm_webhooks`.

### Grant / ACL Pattern

Access control uses a `principal_type` + `principal_id` pair that avoids separate join tables per principal type.

```sql
principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'org', 'global'))
principal_id   UUID
-- Enforced by constraint: global → principal_id IS NULL; user/org → NOT NULL
CONSTRAINT principal_xor CHECK (
  (principal_type = 'global' AND principal_id IS NULL) OR
  (principal_type IN ('user', 'org') AND principal_id IS NOT NULL)
)
```

Tables using this pattern: `jm_workflow_grants`, `jm_workflow_instance_grants`.

### Immutable Event Log

`jm_workflow_instance_events` uses `BIGSERIAL` for guaranteed per-instance ordering and is never updated or deleted. Query it for audit, debugging, and live-status SSE streams.

### Encrypted Secret Storage

`jm_secrets` stores `ciphertext`, `iv`, and `auth_tag` as `BYTEA`. The encryption key (`JM_SECRET_ENCRYPTION_KEY`) never touches the database. Decryption occurs exclusively in `packages/secrets/src/crypto.ts`. Never log decrypted values.

### JSONB for Flexible Configuration

High-variability config is stored as JSONB rather than proliferating columns:

| Table | JSONB columns | Purpose |
|---|---|---|
| `jm_workflow_versions` | `definition` | Full workflow graph (nodes, edges, config) |
| `jm_workflow_instances` | `definition_snapshot`, `inputs`, `outputs` | Immutable run-time state |
| `jm_custom_ai_steps` | `input_fields`, `output_schema`, `default_mcp_ids`, `slots` | Step configuration |
| `jm_webhooks` | `auth`, `payload_schema` | Provider auth config + expected payload shape |
| `jm_mcp_instances` | `args`, `bindings` | Transport arguments + secret env-var bindings |
| `jm_node_executions` | `input`, `output` | Per-node I/O at run time |

---

## Migration Rules (summary)

Full rules in [DEPLOYMENT.md](DEPLOYMENT.md). Key constraints:

1. Migrations are **append-only** — never edit or delete an applied migration.
2. Ship the migration in the **same PR** as the code that depends on it.
3. No implicit multi-hour table locks. No `NOT NULL` on a populated column without a documented backfill strategy.
4. Destructive migrations (drop column / table) require explicit user approval and a documented rollback plan.
5. Use `UNIQUE NULLS NOT DISTINCT` for nullable composite-unique constraints (PostgreSQL 15+).
