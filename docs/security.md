# Journeyman Pipeline — Security Reference

## 1. Threat Model

**In-Scope (Protected)**

- **Webhook impersonation**: Attacker crafts fake webhook payloads with forged signatures to trigger false runs
- **Unauthenticated API access**: Attacker calls management endpoints without valid bearer token
- **Sensitive data leakage via payloads**: Ticket content (titles, descriptions, comments, user PII) exposed in unencrypted state files or logs

**Out-of-Scope (Not Protected)**

- **Compromised environment**: If the host is fully compromised, all bets are off
- **Malicious adapters**: Third-party adapter code running inside the process
- **Targeted TLS attacks**: Handled by reverse proxy in front of the service
- **Access to environment variables**: Assumes `JOURNEYMAN_API_TOKEN` and webhook secrets are protected at the OS level

---

## 2. Filesystem Permissions

Lock the workspace directory so only the service user can read state files and logs:

```bash
sudo chown -R journeyman:journeyman workspaces/
sudo chmod 700 workspaces/
```

**Rationale**: State files (`runs/*/state.json`) and logs contain ticket content—titles, descriptions, comments. Restrict read access to the service user only.

---

## 3. Bearer Token

The management API is protected by `JOURNEYMAN_API_TOKEN` environment variable.

- **Format**: Long random string, 32+ characters
- **Placement**: Server-only environment variable, never committed to version control
- **Validation**: Constant-time string comparison
- **Rotation**:
  1. Generate new token
  2. Update the `JOURNEYMAN_API_TOKEN` env var
  3. Restart the server
  4. Old token becomes invalid immediately

---

## 4. Per-Webhook Secrets

Each webhook source (GitHub, GitLab, Jira) uses a shared secret between the platform's webhook config and the server.

**GitHub**: `X-Hub-Signature-256` HMAC
- Webhook config stores secret: `https://github.com/org/repo/settings/hooks`
- Server env var: `GITHUB_WEBHOOK_SECRET` (or product override)
- Validation: HMAC-SHA256 comparison

**GitLab**: `X-Gitlab-Token` constant-time compare
- Webhook config stores secret: `https://gitlab.com/group/project/-/hooks`
- Server env var: `GITLAB_WEBHOOK_SECRET` (or product override)
- Validation: Constant-time string equality

**Jira**: `Authorization: Bearer <secret>` bearer token compare
- Webhook config stores secret: `https://jira.example.com/secure/project/hooks`
- Server env var: `JIRA_WEBHOOK_SECRET` (or product override)
- Validation: Constant-time bearer comparison

---

## 5. Per-Product Secret Override

Rotate a single product's webhook secret without affecting others:

```yaml
products:
  edgereg:
    webhookSecrets:
      github: EDGEREG_GH_WEBHOOK_SECRET
      gitlab: EDGEREG_GL_WEBHOOK_SECRET
      jira: EDGEREG_JL_WEBHOOK_SECRET
```

**Rotation procedure**:
1. Generate new secret
2. Update both the webhook platform config (GitHub/GitLab/Jira) and the corresponding env var
3. Perform this update simultaneously if possible; brief overlap where either secret verifies is acceptable
4. Restart server

---

## 6. Payload Redaction

Each `ITriggerSource` implementation strips sensitive fields before the payload lands in state:

**GitHub**
- Remove: `sender` (user PII), `installation` (internal GitHub state)
- Keep: repo name, branch, PR number, commit hash

**GitLab**
- Remove: `user` (user PII)
- Keep: project name, branch, MR IID, commit hash

**Jira**
- Remove: `user` (user PII, custom fields that may contain PII)
- Keep: issue key, summary, description (assess PII in your ticket content), component

**Management API**
- Remove: `Authorization` header value
- Keep: endpoint, method, status code

---

## 7. What's Stored in State

**Stored in state files** (`runs/*/state.json`):
- Ticket title, description, comments (from `addComment()` body)
- Artifact handles (file paths, S3 keys—not the raw blob content)
- Adapter results, timestamps, step details

**Not stored**:
- Raw file artifacts (stored separately in artifact store)
- Environment variables, secrets, tokens
- Full user objects (user names/IDs kept minimal)

**Important**: If PII ends up in ticket descriptions (e.g., customer names, email addresses, phone numbers in a support ticket), it will be present in state files. Restrict filesystem access accordingly.

---

## 8. Artifact Encryption

**Current**: `FileArtifactStore` stores content in plaintext on disk at `workspaces/artifacts/`.

**For higher-sensitivity environments**, swap the backend:

1. **S3 with server-side encryption**:
   - Implement `IArtifactStore` interface against S3
   - Enable `sse-s3` or `sse-kms` in S3 bucket config
   - Interface is unchanged; steps don't need to change

2. **LUKS-encrypted volume**:
   - Mount `workspaces/` on an encrypted volume
   - Same filesystem API; transparent to the application

---

## 9. State-at-Rest Encryption

**Current**: `FileStateStore` stores state in plaintext JSON at `workspaces/runs/*/state.json`.

**For higher-sensitivity environments**, swap the backend:

1. **PostgreSQL with Transparent Data Encryption (TDE)**:
   - Implement `IStateStore` interface against Postgres
   - Enable TDE on the Postgres instance
   - Interface is unchanged; steps don't need to change

2. **LUKS-encrypted volume**:
   - Mount `workspaces/` on an encrypted volume
   - Same filesystem API; transparent to the application

---

## 10. Single-Instance Caveat

**Deduplication and concurrency** are in-process, not distributed:

- Only one instance can safely run at a time for a given set of products
- For strict tenant isolation on a multi-tenant host, run one instance per tenant
- For high availability (HA), this requires the future Postgres state store + queue-backed dispatcher (not yet implemented)

---

## 11. Secret Rotation Procedure

**One-time secret rotation** (all products):

1. Generate new secret (e.g., `openssl rand -hex 32`)
2. Update the server env var (`JOURNEYMAN_API_TOKEN`, `GITHUB_WEBHOOK_SECRET`, etc.)
3. Restart the server
4. Old secrets become invalid immediately

**Per-product secret rotation**:

1. Generate new product-specific secret
2. Update the webhook platform config (GitHub/GitLab/Jira): paste new secret
3. Update the server env var: `EDGEREG_GH_WEBHOOK_SECRET=<new-secret>`
4. Restart server
5. Brief overlap where either old or new secret verifies is acceptable; constant-time compares prevent timing leaks

---

## 12. Audit Log

**For v1**, state files and trace logs **ARE** the audit trail:

- Every `Run` includes:
  - `createdAt`, `updatedAt` timestamps
  - `steps[].startedAt`, `steps[].endedAt` for each step
  - All adapter results and error messages
  
- Trace logs include:
  - Webhook receipt, signature validation result
  - API call details (endpoint, method, status)
  - Step execution timeline

**Long-term retention**:
- Archive state files (`workspaces/runs/*/state.json`) and logs separately
- Keep them outside the `runs/` directory (which is pruned by `journeyman sweep`)
- Consider off-site storage for regulatory/compliance requirements

